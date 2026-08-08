import { desc, eq, sql } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { sightings } from "../../../db/schema";

const allowedActivities = new Set(["tennis", "volleyball", "cs2", "beer", "bar", "other"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}

async function ensureSchema() {
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS sightings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      activity TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      happened_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS sightings_happened_at_idx ON sightings (happened_at DESC)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS sightings_activity_idx ON sightings (activity)"),
  ]);
}

async function seedIfEmpty() {
  const db = getDb();
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(sightings);
  if (Number(count) > 0) return;

  const now = Date.now();
  await db.insert(sightings).values([
    {
      lat: 61.2559,
      lon: 73.3896,
      activity: "tennis",
      comment: "Разминался у сетки и уверял, что это всего на час.",
      happenedAt: new Date(now - 42 * 60_000).toISOString(),
    },
    {
      lat: 61.2495,
      lon: 73.4054,
      activity: "bar",
      comment: "Замечен у окна. На вопрос «ты где?» ответил: «почти дома».",
      happenedAt: new Date(now - 3.2 * 60 * 60_000).toISOString(),
    },
    {
      lat: 61.2621,
      lon: 73.3728,
      activity: "volleyball",
      comment: "Пришёл на одну игру, остался на четыре.",
      happenedAt: new Date(now - 23 * 60 * 60_000).toISOString(),
    },
    {
      lat: 61.2417,
      lon: 73.4192,
      activity: "cs2",
      comment: "Вышел на одну катку. Дальше след потерян.",
      happenedAt: new Date(now - 29 * 60 * 60_000).toISOString(),
    },
    {
      lat: 61.2701,
      lon: 73.401,
      activity: "beer",
      comment: "Сидел спокойно, никуда не пропадал — редкий случай.",
      happenedAt: new Date(now - 52 * 60 * 60_000).toISOString(),
    },
  ]);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    await seedIfEmpty();
    const activity = new URL(request.url).searchParams.get("activity");
    const db = getDb();
    const rows = activity && allowedActivities.has(activity)
      ? await db
          .select()
          .from(sightings)
          .where(eq(sightings.activity, activity))
          .orderBy(desc(sightings.happenedAt), desc(sightings.id))
          .limit(150)
      : await db
          .select()
          .from(sightings)
          .orderBy(desc(sightings.happenedAt), desc(sightings.id))
          .limit(150);

    return json({ sightings: rows });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить отметки" },
      500,
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
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

    const comment = payload.comment?.trim().slice(0, 280) ?? "";
    const db = getDb();
    const [sighting] = await db
      .insert(sightings)
      .values({
        lat: payload.lat,
        lon: payload.lon,
        activity: payload.activity,
        comment,
        happenedAt: new Date(payload.happenedAt).toISOString(),
      })
      .returning();

    return json({ sighting }, 201);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Не удалось сохранить отметку" },
      500,
    );
  }
}
