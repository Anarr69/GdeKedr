import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import {
  activityIds,
  addSighting,
  deleteSighting,
  listSightings,
  type Activity,
  type Sighting,
} from "../../../lib/sightings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedActivities = new Set<string>(activityIds);
const ownerCookieName = "gdekedr-owner";
const ownerCookieMaxAge = 60 * 60 * 24 * 365 * 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}

function isOwnerToken(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{40,128}$/.test(value));
}

function hashOwnerToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function getOwnerToken(create = false) {
  const cookieStore = await cookies();
  const current = cookieStore.get(ownerCookieName)?.value;
  if (isOwnerToken(current)) return current;
  if (!create) return null;

  const token = randomBytes(32).toString("base64url");
  cookieStore.set(ownerCookieName, token, {
    httpOnly: true,
    maxAge: ownerCookieMaxAge,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  return token;
}

function toPublicSighting(sighting: Sighting, ownerHash: string | null) {
  const { ownerHash: storedOwnerHash, ...publicSighting } = sighting;
  return {
    ...publicSighting,
    canDelete: Boolean(ownerHash && storedOwnerHash === ownerHash),
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  try {
    const activity = new URL(request.url).searchParams.get("activity");
    const sightings = await listSightings();
    const ownerToken = await getOwnerToken();
    const ownerHash = ownerToken ? hashOwnerToken(ownerToken) : null;
    const visibleSightings =
      activity && allowedActivities.has(activity)
        ? sightings.filter((item) => item.activity === activity)
        : sightings;
    return json({
      sightings: visibleSightings.map((item) => toPublicSighting(item, ownerHash)),
    });
  } catch (error) {
    console.error("[api/sightings] GET failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return json(
      { error: "Не удалось загрузить отметки. Обновите страницу." },
      500,
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      lat?: number;
      lon?: number;
      activity?: string;
      comment?: string;
      happenedAt?: string;
    };

    if (
      typeof payload.lat !== "number" ||
      typeof payload.lon !== "number" ||
      payload.lat < 60.8 ||
      payload.lat > 61.7 ||
      payload.lon < 72.7 ||
      payload.lon > 74.2
    ) {
      return json({ error: "Выберите точку в пределах Сургута" }, 400);
    }
    if (!payload.activity || !allowedActivities.has(payload.activity)) {
      return json({ error: "Выберите занятие" }, 400);
    }
    if (!payload.happenedAt || Number.isNaN(Date.parse(payload.happenedAt))) {
      return json({ error: "Укажите корректные дату и время" }, 400);
    }

    const ownerToken = await getOwnerToken(true);
    const ownerHash = hashOwnerToken(ownerToken!);

    const sighting = await addSighting({
      lat: payload.lat,
      lon: payload.lon,
      activity: payload.activity as Activity,
      comment: payload.comment?.trim().slice(0, 280) ?? "",
      happenedAt: new Date(payload.happenedAt).toISOString(),
      ownerHash,
    });

    return json({ sighting: toPublicSighting(sighting, ownerHash) }, 201);
  } catch (error) {
    console.error("[api/sightings] POST failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return json(
      { error: "Не удалось сохранить отметку. Попробуйте ещё раз." },
      500,
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const payload = (await request.json()) as { id?: number };
    if (!Number.isSafeInteger(payload.id) || payload.id! <= 0) {
      return json({ error: "Некорректная отметка" }, 400);
    }

    const ownerToken = await getOwnerToken();
    if (!ownerToken) {
      return json({ error: "Эту отметку может удалить только её автор" }, 403);
    }

    const result = await deleteSighting(payload.id!, hashOwnerToken(ownerToken));
    if (result === "not_found") return json({ error: "Отметка уже удалена" }, 404);
    if (result === "forbidden") {
      return json({ error: "Эту отметку может удалить только её автор" }, 403);
    }

    return json({ deleted: true, id: payload.id });
  } catch (error) {
    console.error("[api/sightings] DELETE failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return json(
      { error: "Не удалось удалить отметку. Попробуйте ещё раз." },
      500,
    );
  }
}
