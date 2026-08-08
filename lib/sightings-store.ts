import {
  BlobPreconditionFailedError,
  get,
  put,
} from "@vercel/blob";

export const activityIds = [
  "tennis",
  "volleyball",
  "cs2",
  "beer",
  "bar",
  "other",
] as const;

export type Activity = (typeof activityIds)[number];

export type Sighting = {
  id: number;
  lat: number;
  lon: number;
  activity: Activity;
  comment: string;
  happenedAt: string;
  createdAt: string;
};

const DATA_PATH = "gdekedr/sightings.json";
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

function initialSightings(): Sighting[] {
  const now = Date.now();
  return [
    {
      id: 1005,
      lat: 61.2559,
      lon: 73.3896,
      activity: "tennis",
      comment: "Разминался у сетки и уверял, что это всего на час.",
      happenedAt: new Date(now - 42 * 60_000).toISOString(),
      createdAt: new Date(now - 40 * 60_000).toISOString(),
    },
    {
      id: 1004,
      lat: 61.2495,
      lon: 73.4054,
      activity: "bar",
      comment: "Замечен у окна. На вопрос «ты где?» ответил: «почти дома».",
      happenedAt: new Date(now - 3.2 * 60 * 60_000).toISOString(),
      createdAt: new Date(now - 3.1 * 60 * 60_000).toISOString(),
    },
    {
      id: 1003,
      lat: 61.2621,
      lon: 73.3728,
      activity: "volleyball",
      comment: "Пришёл на одну игру, остался на четыре.",
      happenedAt: new Date(now - 23 * 60 * 60_000).toISOString(),
      createdAt: new Date(now - 22.9 * 60 * 60_000).toISOString(),
    },
    {
      id: 1002,
      lat: 61.2417,
      lon: 73.4192,
      activity: "cs2",
      comment: "Вышел на одну катку. Дальше след потерян.",
      happenedAt: new Date(now - 29 * 60 * 60_000).toISOString(),
      createdAt: new Date(now - 28.9 * 60 * 60_000).toISOString(),
    },
    {
      id: 1001,
      lat: 61.2701,
      lon: 73.401,
      activity: "beer",
      comment: "Сидел спокойно, никуда не пропадал — редкий случай.",
      happenedAt: new Date(now - 52 * 60 * 60_000).toISOString(),
      createdAt: new Date(now - 51.9 * 60 * 60_000).toISOString(),
    },
  ];
}

async function readState() {
  const result = await get(DATA_PATH, {
    access: "private",
    useCache: false,
    token: blobToken,
  });
  if (!result || result.statusCode === 304 || !result.stream) {
    return { sightings: initialSightings(), etag: null as string | null };
  }

  const payload = (await new Response(result.stream).json()) as {
    sightings?: Sighting[];
  };
  return {
    sightings: Array.isArray(payload.sightings) ? payload.sightings : initialSightings(),
    etag: result.blob.etag,
  };
}

async function writeState(sightings: Sighting[], etag: string | null) {
  return put(DATA_PATH, JSON.stringify({ sightings }), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: etag !== null,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
    token: blobToken,
    ...(etag ? { ifMatch: etag } : {}),
  });
}

export async function listSightings() {
  const state = await readState();
  if (state.etag) return state.sightings;

  try {
    await writeState(state.sightings, null);
    return state.sightings;
  } catch {
    return (await readState()).sightings;
  }
}

export async function addSighting(
  input: Omit<Sighting, "id" | "createdAt">,
): Promise<Sighting> {
  const createdAt = new Date().toISOString();
  const sighting: Sighting = {
    ...input,
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
    createdAt,
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = await readState();
    const next = [sighting, ...state.sightings].slice(0, 150);
    try {
      await writeState(next, state.etag);
      return sighting;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError && attempt < 3) continue;
      if (attempt < 3 && state.etag === null) continue;
      throw error;
    }
  }

  throw new Error("Не удалось сохранить отметку после нескольких попыток");
}
