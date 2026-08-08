import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  head,
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
  ownerHash?: string;
};

export type DeleteSightingResult = "deleted" | "not_found" | "forbidden";

const DATA_PATH = "gdekedr/sightings.json";
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

function normalizeEtag(etag: string) {
  return etag.replace(/^W\//, "").replace(/^"|"$/g, "");
}

function initialSightings(): Sighting[] {
  return [];
}

async function readState() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let metadata;
    try {
      metadata = await head(DATA_PATH, { token: blobToken });
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        return { sightings: initialSightings(), etag: null as string | null };
      }
      throw error;
    }

    const versionedUrl = new URL(metadata.url);
    versionedUrl.searchParams.set("version", metadata.etag);
    const result = await get(versionedUrl.toString(), {
      access: "private",
      useCache: false,
      token: blobToken,
    });
    if (!result || result.statusCode === 304 || !result.stream) continue;
    if (normalizeEtag(result.blob.etag) !== normalizeEtag(metadata.etag)) {
      console.warn("[sightings] Blob read returned a stale ETag; retrying", {
        attempt: attempt + 1,
      });
      continue;
    }

    const payload = (await new Response(result.stream).json()) as {
      sightings?: Sighting[];
    };
    const confirmedMetadata = await head(DATA_PATH, { token: blobToken });
    if (normalizeEtag(confirmedMetadata.etag) !== normalizeEtag(metadata.etag)) continue;

    return {
      sightings: Array.isArray(payload.sightings) ? payload.sightings : initialSightings(),
      etag: metadata.etag,
    };
  }

  throw new Error("Не удалось получить актуальную версию отметок");
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
      if (error instanceof BlobPreconditionFailedError && attempt < 3) {
        console.warn("[sightings] Blob write conflict; retrying", {
          attempt: attempt + 1,
          etag: state.etag,
        });
        continue;
      }
      if (attempt < 3 && state.etag === null) continue;
      throw error;
    }
  }

  throw new Error("Не удалось сохранить отметку после нескольких попыток");
}

export async function deleteSighting(
  id: number,
  ownerHash: string,
): Promise<DeleteSightingResult> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = await readState();
    const sighting = state.sightings.find((item) => item.id === id);
    if (!sighting) return "not_found";
    if (!sighting.ownerHash || sighting.ownerHash !== ownerHash) return "forbidden";

    const next = state.sightings.filter((item) => item.id !== id);
    try {
      await writeState(next, state.etag);
      return "deleted";
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError && attempt < 3) {
        console.warn("[sightings] Blob delete conflict; retrying", {
          attempt: attempt + 1,
          etag: state.etag,
        });
        continue;
      }
      throw error;
    }
  }

  throw new Error("Не удалось удалить отметку после нескольких попыток");
}
