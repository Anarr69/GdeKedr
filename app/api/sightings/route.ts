import {
  activityIds,
  addSighting,
  listSightings,
  type Activity,
} from "../../../lib/sightings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedActivities = new Set<string>(activityIds);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  try {
    const activity = new URL(request.url).searchParams.get("activity");
    const sightings = await listSightings();
    return json({
      sightings:
        activity && allowedActivities.has(activity)
          ? sightings.filter((item) => item.activity === activity)
          : sightings,
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить отметки" },
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

    const sighting = await addSighting({
      lat: payload.lat,
      lon: payload.lon,
      activity: payload.activity as Activity,
      comment: payload.comment?.trim().slice(0, 280) ?? "",
      happenedAt: new Date(payload.happenedAt).toISOString(),
    });

    return json({ sighting }, 201);
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
