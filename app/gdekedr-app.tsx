"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const SURGUT = { lat: 61.254, lon: 73.3962 };
const TILE_SIZE = 256;
const API_ORIGIN = "";

const ACTIVITIES = [
  { id: "tennis", label: "Играет в теннис", short: "Теннис", icon: "🎾" },
  { id: "volleyball", label: "Играет в волейбол", short: "Волейбол", icon: "🏐" },
  { id: "cs2", label: "Играет в Counter-Strike", short: "Counter-Strike", icon: "🎮" },
  { id: "beer", label: "Пьёт пиво", short: "Пиво", icon: "🍺" },
  { id: "bar", label: "Находится в баре", short: "Бар", icon: "🍸" },
  { id: "other", label: "Занят чем-то ещё", short: "Другое", icon: "🌲" },
] as const;

type Activity = (typeof ACTIVITIES)[number]["id"];

type Sighting = {
  id: number;
  lat: number;
  lon: number;
  activity: Activity;
  comment: string;
  happenedAt: string;
  createdAt: string;
  canDelete: boolean;
};

type Point = { x: number; y: number };

const activityMap = Object.fromEntries(
  ACTIVITIES.map((activity) => [activity.id, activity]),
) as Record<Activity, (typeof ACTIVITIES)[number]>;

function project(lat: number, lon: number, zoom: number): Point {
  const scale = TILE_SIZE * 2 ** zoom;
  const safeLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const sin = Math.sin((safeLat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function unproject(x: number, y: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lon };
}

function formatWhen(value: string, compact = false) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const datePart = sameDay
    ? "сегодня"
    : date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  const timePart = date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return compact ? `${datePart}, ${timePart}` : `${datePart} в ${timePart}`;
}

function toLocalInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function TileMap({
  sightings,
  selectedId,
  picking,
  onSelect,
  onPick,
}: {
  sightings: Sighting[];
  selectedId: number | null;
  picking: boolean;
  onSelect: (id: number) => void;
  onPick: (lat: number, lon: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const [center, setCenter] = useState(SURGUT);
  const [zoom, setZoom] = useState(13);
  const drag = useRef<{
    x: number;
    y: number;
    center: Point;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const centerPoint = useMemo(
    () => project(center.lat, center.lon, zoom),
    [center, zoom],
  );
  const topLeft = {
    x: centerPoint.x - size.width / 2,
    y: centerPoint.y - size.height / 2,
  };

  const tiles = useMemo(() => {
    const tileCount = 2 ** zoom;
    const minX = Math.floor(topLeft.x / TILE_SIZE) - 1;
    const maxX = Math.floor((topLeft.x + size.width) / TILE_SIZE) + 1;
    const minY = Math.max(0, Math.floor(topLeft.y / TILE_SIZE) - 1);
    const maxY = Math.min(
      tileCount - 1,
      Math.floor((topLeft.y + size.height) / TILE_SIZE) + 1,
    );
    const list: Array<{ key: string; x: number; y: number; tileX: number }> = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        list.push({
          key: `${zoom}-${x}-${y}`,
          x,
          y,
          tileX: ((x % tileCount) + tileCount) % tileCount,
        });
      }
    }
    return list;
  }, [size, topLeft.x, topLeft.y, zoom]);

  const markerPositions = useMemo(
    () =>
      sightings.map((sighting) => {
        const point = project(sighting.lat, sighting.lon, zoom);
        return {
          sighting,
          x: point.x - topLeft.x,
          y: point.y - topLeft.y,
        };
      }),
    [sightings, topLeft.x, topLeft.y, zoom],
  );

  const selectedPosition = markerPositions.find(
    ({ sighting }) => sighting.id === selectedId,
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      center: project(center.lat, center.lon, zoom),
      moved: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.current.moved = true;
    const next = unproject(
      drag.current.center.x - dx,
      drag.current.center.y - dy,
      zoom,
    );
    setCenter(next);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasDrag = drag.current?.moved;
    drag.current = null;
    if (!picking || wasDrag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: topLeft.x + event.clientX - rect.left,
      y: topLeft.y + event.clientY - rect.top,
    };
    const coordinate = unproject(point.x, point.y, zoom);
    onPick(coordinate.lat, coordinate.lon);
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setZoom((value) => Math.max(11, Math.min(17, value + (event.deltaY < 0 ? 1 : -1))));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 90;
    const current = project(center.lat, center.lon, zoom);
    if (event.key === "+" || event.key === "=") setZoom((z) => Math.min(17, z + 1));
    else if (event.key === "-") setZoom((z) => Math.max(11, z - 1));
    else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const x = current.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0);
      const y = current.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0);
      setCenter(unproject(x, y, zoom));
    }
  };

  return (
    <div
      ref={viewportRef}
      className={`tile-map${picking ? " is-picking" : ""}`}
      role="application"
      aria-label="Интерактивная карта Сургута"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      {tiles.map((tile) => (
        <img
          className="map-tile"
          key={tile.key}
          src={`https://tile.openstreetmap.org/${zoom}/${tile.tileX}/${tile.y}.png`}
          alt=""
          draggable={false}
          style={{
            left: tile.x * TILE_SIZE - topLeft.x,
            top: tile.y * TILE_SIZE - topLeft.y,
          }}
        />
      ))}

      {markerPositions.map(({ sighting, x, y }) => {
        if (x < -80 || y < -80 || x > size.width + 80 || y > size.height + 80) return null;
        const activity = activityMap[sighting.activity] ?? activityMap.other;
        return (
          <button
            key={sighting.id}
            type="button"
            className={`marker${selectedId === sighting.id ? " selected" : ""}`}
            style={{ left: x, top: y }}
            aria-label={`${activity.label}, ${formatWhen(sighting.happenedAt)}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSelect(sighting.id)}
          >
            <img src="/kedr.png" alt="" />
            <span className="marker-activity" aria-hidden="true">
              {activity.icon}
            </span>
          </button>
        );
      })}

      {selectedPosition && (
        <div
          className="map-popup"
          style={{
            left: Math.max(150, Math.min(size.width - 150, selectedPosition.x)),
            top: Math.max(150, selectedPosition.y - 74),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="popup-top">
            <span className="popup-activity">
              {activityMap[selectedPosition.sighting.activity]?.icon ?? "🌲"}{" "}
              {activityMap[selectedPosition.sighting.activity]?.label ?? "Здесь был Кедр"}
            </span>
            <span className="popup-time">{formatWhen(selectedPosition.sighting.happenedAt, true)}</span>
          </div>
          <p>{selectedPosition.sighting.comment || "Комментарий не оставили."}</p>
        </div>
      )}

      <div className="map-vignette" />

      <div className="map-controls" onPointerDown={(event) => event.stopPropagation()}>
        <button
          className="map-control"
          type="button"
          aria-label="Приблизить карту"
          onClick={() => setZoom((value) => Math.min(17, value + 1))}
        >
          +
        </button>
        <button
          className="map-control"
          type="button"
          aria-label="Отдалить карту"
          onClick={() => setZoom((value) => Math.max(11, value - 1))}
        >
          −
        </button>
        <button
          className="map-control"
          type="button"
          aria-label="Вернуться к центру Сургута"
          onClick={() => {
            setCenter(SURGUT);
            setZoom(13);
          }}
        >
          ◎
        </button>
      </div>
    </div>
  );
}

export function GdeKedrApp() {
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [filter, setFilter] = useState<Activity | "all">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [coordinate, setCoordinate] = useState(SURGUT);
  const [activity, setActivity] = useState<Activity>("other");
  const [happenedAt, setHappenedAt] = useState(toLocalInputValue());
  const [comment, setComment] = useState("");

  const loadSightings = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`${API_ORIGIN}/api/sightings`, { cache: "no-store" });
      if (!response.ok) throw new Error("Не удалось загрузить отметки");
      const data = (await response.json()) as { sightings: Sighting[] };
      setSightings(data.sightings);
      setSelectedId((current) =>
        current && data.sightings.some((item) => item.id === current)
          ? current
          : (data.sightings[0]?.id ?? null),
      );
    } catch {
      setError("Карта открылась, но история пока недоступна. Попробуйте обновить страницу.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSightings();
    const timer = window.setInterval(() => void loadSightings(true), 15_000);
    return () => window.clearInterval(timer);
  }, [loadSightings]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visibleSightings = useMemo(
    () => sightings.filter((sighting) => filter === "all" || sighting.activity === filter),
    [filter, sightings],
  );

  const latest = sightings[0];

  const openComposer = () => {
    setError("");
    setCoordinate(SURGUT);
    setHappenedAt(toLocalInputValue());
    setComposerOpen(true);
  };

  const submitSighting = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${API_ORIGIN}/api/sightings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: coordinate.lat,
          lon: coordinate.lon,
          activity,
          happenedAt: new Date(happenedAt).toISOString(),
          comment,
        }),
      });
      const result = (await response.json()) as { sighting?: Sighting; error?: string };
      if (!response.ok || !result.sighting) throw new Error(result.error || "Не удалось сохранить отметку");
      setSightings((current) => [result.sighting!, ...current]);
      setSelectedId(result.sighting.id);
      setComment("");
      setComposerOpen(false);
      setToast("Отметка добавлена — Кедр найден!");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось сохранить отметку");
    } finally {
      setSaving(false);
    }
  };

  const removeSighting = async (sighting: Sighting) => {
    setDeletingId(sighting.id);
    try {
      const response = await fetch(`${API_ORIGIN}/api/sightings`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sighting.id }),
      });
      const result = (await response.json()) as { deleted?: boolean; error?: string };
      if (!response.ok || !result.deleted) {
        throw new Error(result.error || "Не удалось удалить отметку");
      }

      const next = sightings.filter((item) => item.id !== sighting.id);
      setSightings(next);
      setSelectedId((current) =>
        current === sighting.id ? (next[0]?.id ?? null) : current,
      );
      setToast("Ваша отметка удалена");
    } catch (deleteError) {
      setToast(
        deleteError instanceof Error ? deleteError.message : "Не удалось удалить отметку",
      );
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  return (
    <main className="app-shell">
      <section className="map-shell" aria-label="Карта отметок Кедра">
        <TileMap
          sightings={visibleSightings}
          selectedId={selectedId}
          picking={composerOpen}
          onSelect={setSelectedId}
          onPick={(lat, lon) => {
            setCoordinate({ lat, lon });
            setToast("Место выбрано на карте");
          }}
        />
        <div className="map-label">
          <span className="live-dot" />
          Сургут · карта обновляется
        </div>
        <button className="add-button" type="button" onClick={openComposer}>
          <span className="add-plus">+</span>
          Отметить Кедра
        </button>
      </section>

      <aside className="sidebar">
        {loading && <div className="loading-strip" />}
        <div className="sidebar-head">
          <div className="brand-row">
            <div className="brand">
              <img className="brand-photo" src="/kedr.png" alt="Кедр" />
              <h1 className="brand-name">
                Где<span>Кедр</span>
              </h1>
            </div>
            <div className="city-pill">📍 Сургут</div>
          </div>

          <div className="status-card">
            <div>
              <p className="eyebrow">Последний раз замечен</p>
              <p className="status-title">
                {latest ? activityMap[latest.activity]?.label : "Пока ищем Кедра"}
              </p>
            </div>
            <span className="status-time">
              {latest ? formatWhen(latest.happenedAt, true) : "—"}
            </span>
          </div>

          <div className="filters" aria-label="Фильтр занятий">
            <button
              type="button"
              className={`filter-chip${filter === "all" ? " active" : ""}`}
              onClick={() => setFilter("all")}
            >
              Все
            </button>
            {ACTIVITIES.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`filter-chip${filter === item.id ? " active" : ""}`}
                onClick={() => setFilter(item.id)}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.short}
              </button>
            ))}
          </div>
        </div>

        <div className="feed-head">
          <h2>Последние наблюдения</h2>
          <span className="feed-count">{visibleSightings.length} на карте</span>
        </div>
        <div className="feed">
          {visibleSightings.map((sighting) => {
            const item = activityMap[sighting.activity] ?? activityMap.other;
            return (
              <div
                className={`feed-item${selectedId === sighting.id ? " selected" : ""}`}
                key={sighting.id}
              >
                <button
                  type="button"
                  className="feed-select"
                  onClick={() => setSelectedId(sighting.id)}
                >
                  <span className="activity-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="feed-main">
                    <span className="feed-top">
                      <span className="feed-title">{item.label}</span>
                      <span className="feed-time">{formatWhen(sighting.happenedAt, true)}</span>
                    </span>
                    <span className="feed-comment">
                      {sighting.comment || "Без комментария — загадочный Кедр."}
                    </span>
                  </span>
                </button>
                {sighting.canDelete &&
                  (confirmDeleteId === sighting.id ? (
                    <span className="delete-confirm">
                      <button
                        type="button"
                        className="delete-confirm-button"
                        disabled={deletingId === sighting.id}
                        onClick={() => void removeSighting(sighting)}
                      >
                        {deletingId === sighting.id ? "Удаляем…" : "Удалить"}
                      </button>
                      <button
                        type="button"
                        className="delete-cancel-button"
                        aria-label="Отменить удаление"
                        disabled={deletingId === sighting.id}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Нет
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="delete-sighting"
                      aria-label={`Удалить вашу отметку: ${sighting.comment || item.label}`}
                      title="Удалить мою отметку"
                      onClick={() => setConfirmDeleteId(sighting.id)}
                    >
                      ×
                    </button>
                  ))}
              </div>
            );
          })}
          {!loading && visibleSightings.length === 0 && (
            <div className="empty-feed">По этому фильтру Кедра ещё не замечали.</div>
          )}
        </div>
      </aside>

      {composerOpen && (
        <form className="composer" onSubmit={submitSighting}>
          <div className="composer-head">
            <div>
              <h2>Новая отметка</h2>
              <p className="composer-help">Нажмите на карту, чтобы точно указать место.</p>
            </div>
            <button
              className="close-button"
              type="button"
              aria-label="Закрыть форму"
              onClick={() => setComposerOpen(false)}
            >
              ×
            </button>
          </div>

          <div className="field-grid">
            <div className="field">
              <label htmlFor="activity">Что делал</label>
              <select
                id="activity"
                value={activity}
                onChange={(event) => setActivity(event.target.value as Activity)}
              >
                {ACTIVITIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.icon} {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="happened-at">Когда</label>
              <input
                id="happened-at"
                type="datetime-local"
                required
                value={happenedAt}
                onChange={(event) => setHappenedAt(event.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="comment">Комментарий</label>
            <textarea
              id="comment"
              maxLength={280}
              placeholder="Например: снова сказал, что будет через 5 минут…"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>

          <div className="coordinates">
            Точка: {coordinate.lat.toFixed(5)}, {coordinate.lon.toFixed(5)}
          </div>
          {error && <p className="error-note">{error}</p>}
          <button className="submit-button" type="submit" disabled={saving}>
            {saving ? "Сохраняем…" : "Добавить на карту"}
          </button>
        </form>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
