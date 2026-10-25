import { useEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Line,
  Circle,
  Text,
  Group,
  Transformer,
} from "react-konva";
import Konva from "konva";
import {
  MousePointer2,
  Hand,
  Building2,
  Store,
  DoorOpen,
  Footprints,
  MapPin,
  Type,
  Route,
  Square,
  ArrowUpDown,
  FolderOpen,
  Download,
  Undo2,
  Redo2,
  Plus,
  Minus,
  Layers,
  Map as MapIcon,
  CheckCircle2,
  Trash2,
  Settings2,
  ChevronRight,
  BookOpen,
  LocateFixed,
} from "lucide-react";
import {
  newDocument,
  validateDocument,
  assertDocument,
  findRoute,
  type CamapDocument,
  type Feature,
  type FeatureKind,
  type Point,
  type Collection,
  type RouteNode,
} from "@campura/camap";
import { openDocument, saveDocument } from "./files";
import { addFeature, updateFeature, deleteEntity, uid, labels } from "./model";
import {
  createBasemap,
  validateMapSettings,
  mapCredentialsNeedReload,
  type Basemap,
  type MapSettings,
} from "./amap";
import {
  locateCampus,
  canOpenLocationSettings,
  openLocationSettings,
} from "./location";
import {
  useTheme,
  canvasPalettes,
  type Theme,
  type ThemePreference,
} from "./theme";
import demo from "./demo.json";
import {
  loadMapCredentials,
  saveMapCredentials,
  clearMapCredentials,
  emptyMapSettings,
} from "./credentials";

type Tool = FeatureKind | "select" | "pan" | "node" | "edge";
const tools: { id: Tool; label: string; Icon: typeof Square }[] = [
  { id: "select", label: "选择", Icon: MousePointer2 },
  { id: "pan", label: "漫游", Icon: Hand },
  { id: "building", label: "建筑", Icon: Building2 },
  { id: "merchant", label: "商户", Icon: Store },
  { id: "door", label: "门", Icon: DoorOpen },
  { id: "stairs", label: "楼梯", Icon: Footprints },
  { id: "elevator", label: "电梯", Icon: ArrowUpDown },
  { id: "gate", label: "校门", Icon: DoorOpen },
  { id: "poi", label: "地标", Icon: MapPin },
  { id: "area", label: "区域", Icon: Square },
  { id: "room", label: "房间", Icon: Square },
  { id: "text", label: "文字", Icon: Type },
  { id: "node", label: "路点", Icon: MapPin },
  { id: "edge", label: "道路", Icon: Route },
];
const recoveryKey = "camap-composer-recovery-v1";
function demoDocument(): CamapDocument {
  const d: unknown = structuredClone(demo);
  assertDocument(d);
  return d;
}
function initial(): CamapDocument {
  try {
    const raw = localStorage.getItem(recoveryKey);
    if (raw) {
      const d = JSON.parse(raw);
      if (!validateDocument(d).length) return d;
    }
  } catch {
    /* Show a fresh demo if storage is unavailable. */
  }
  return demoDocument();
}
const flatten = (ps: Point[]) => ps.flat();
export default function App() {
  const { preference, setPreference, theme } = useTheme();
  const palette = canvasPalettes[theme],
    colors = palette.features;
  const latestTheme = useRef(theme);
  latestTheme.current = theme;
  const [doc, setDoc] = useState<CamapDocument>(initial),
    [tool, setTool] = useState<Tool>("select"),
    [selected, setSelected] = useState<{
      collection: Collection;
      id: string;
    } | null>(null);
  const [frameId, setFrameId] = useState(""),
    [buildingId, setBuildingId] = useState(""),
    [levelId, setLevelId] = useState("");
  const [past, setPast] = useState<CamapDocument[]>([]),
    [future, setFuture] = useState<CamapDocument[]>([]),
    [message, setMessage] = useState(
      "画布已就绪。选择工具，在画布上放置或拖拽绘制。",
    );
  const [size, setSize] = useState({ width: 800, height: 640 }),
    [view, setView] = useState({ x: 0, y: 0, scale: 3 }),
    [snap, setSnap] = useState(true),
    [routeVisible, setRouteVisible] = useState(true),
    [hidden, setHidden] = useState<FeatureKind[]>([]);
  const [dragStart, setDragStart] = useState<Point | null>(null),
    [cursor, setCursor] = useState<Point | null>(null),
    [edgeStart, setEdgeStart] = useState<string | null>(null),
    [search, setSearch] = useState("");
  const [configOpen, setConfigOpen] = useState(false),
    [mapSettings, setMapSettings] = useState<MapSettings>(emptyMapSettings),
    [mapOn, setMapOn] = useState(false),
    [mapTick, setMapTick] = useState(0);
  const [mapLoading, setMapLoading] = useState(false),
    [mapError, setMapError] = useState(""),
    [connectionAttempt, setConnectionAttempt] = useState(0);
  const appliedMapSettings = useRef(mapSettings);
  const [credentialsReady, setCredentialsReady] = useState(false),
    [credentialBusy, setCredentialBusy] = useState(false),
    [credentialNote, setCredentialNote] = useState("正在读取本机配置…");
  useEffect(() => {
    let disposed = false;
    loadMapCredentials()
      .then((settings) => {
        if (disposed) return;
        if (settings) setMapSettings(settings);
        setCredentialNote(
          settings
            ? "已从本机系统凭据库读取配置，可直接连接。"
            : "尚未保存配置，填写后可保存到本机。",
        );
      })
      .catch(() => {
        if (!disposed)
          setCredentialNote(
            "无法读取本机凭据库。请检查系统权限；已有配置不会自动覆盖。",
          );
      })
      .finally(() => {
        if (!disposed) setCredentialsReady(true);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const [locating, setLocating] = useState(false),
    [locationHint, setLocationHint] = useState(
      "请将校园放到地图中心，再确认开始绘制。",
    );
  const locationAttempt = useRef<AbortController | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false),
    [routeFrom, setRouteFrom] = useState(""),
    [routeTo, setRouteTo] = useState(""),
    [accessible, setAccessible] = useState(false),
    [preferCovered, setPreferCovered] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null),
    mapElement = useRef<HTMLDivElement>(null),
    stage = useRef<Konva.Stage>(null),
    map = useRef<Basemap | null>(null),
    latest = useRef(doc);
  const activeFrame = doc.frames.find((f) => f.id === frameId) || doc.frames[0],
    building = doc.features.find((f) => f.id === buildingId),
    levels = building?.levels || [];
  const selectedFeature =
    selected?.collection === "features"
      ? doc.features.find((f) => f.id === selected.id)
      : undefined;
  const selectedNode =
    selected?.collection === "nodes"
      ? doc.nodes.find((f) => f.id === selected.id)
      : undefined;
  const selectedEdge =
    selected?.collection === "edges"
      ? doc.edges.find((f) => f.id === selected.id)
      : undefined;
  const issues = useMemo(() => validateDocument(doc), [doc]);
  const route = useMemo(
    () =>
      routeFrom && routeTo
        ? findRoute(doc, routeFrom, routeTo, { accessible, preferCovered })
        : null,
    [doc, routeFrom, routeTo, accessible, preferCovered],
  );
  useEffect(() => {
    latest.current = doc;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(recoveryKey, JSON.stringify(doc));
      } catch {
        setMessage("自动恢复空间不足，请导出文件保存。");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [doc]);
  useEffect(() => {
    if (!wrapper.current) return;
    const observer = new ResizeObserver(([e]) =>
      setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    map.current?.setTheme(theme);
  }, [theme]);
  useEffect(() => {
    if (!mapOn || !mapElement.current) {
      setMapLoading(false);
      setLocating(false);
      return;
    }
    const controller = new AbortController();
    let instance: Basemap | null = null;
    setMapLoading(true);
    setMapError("");
    createBasemap(
      mapElement.current,
      appliedMapSettings.current,
      activeFrame?.bindings.amap,
      () => setMapTick((n) => n + 1),
      latestTheme.current,
      controller.signal,
    )
      .then((m) => {
        if (controller.signal.aborted) {
          m.destroy();
          return;
        }
        instance = m;
        m.setTheme(latestTheme.current);
        map.current = m;
        setMapTick((n) => n + 1);
        setMapLoading(false);
        if (activeFrame?.bindings.amap) {
          setMessage(
            "已回到保存的校园位置。使用「漫游」拖动地图，再选择工具绘制。",
          );
        } else {
          setTool("pan");
          void findCampus(m);
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof Error
            ? error.message
            : "底图连接失败，请检查配置后重试。";
        setMapError(message);
        setMessage(message);
        setMapOn(false);
        setMapLoading(false);
      });
    return () => {
      controller.abort();
      locationAttempt.current?.abort();
      instance?.destroy();
      if (map.current === instance) map.current = null;
    };
  }, [
    mapOn,
    connectionAttempt,
    activeFrame?.id,
    activeFrame?.bindings.amap?.longitude,
    activeFrame?.bindings.amap?.latitude,
    activeFrame?.bindings.amap?.rotation,
  ]);
  function commit(next: CamapDocument) {
    // Capture before React schedules the updater; latest.current changes below.
    const previous = latest.current;
    setPast((p) => [...p.slice(-59), previous]);
    setFuture([]);
    latest.current = next;
    setDoc(next);
  }
  function undo() {
    if (!past.length) return;
    const p = past[past.length - 1];
    setFuture((f) => [doc, ...f]);
    setPast(past.slice(0, -1));
    setDoc(p);
    latest.current = p;
  }
  function redo() {
    if (!future.length) return;
    setPast((p) => [...p, doc]);
    setDoc(future[0]);
    latest.current = future[0];
    setFuture(future.slice(1));
  }
  function replace(next: CamapDocument) {
    commit(next);
    setSelected(null);
    setBuildingId("");
    setLevelId("");
    setFrameId(next.frames[0]?.id || "");
    setMapOn(false);
    setMapError("");
    setView({ x: 0, y: 0, scale: 3 });
  }
  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }
  async function save() {
    if (await saveDocument(doc))
      setMessage("已导出 .camap，可在学校端「校园地图」上传。");
  }
  function remove() {
    if (!selected) return;
    if (
      selectedFeature?.kind === "building" &&
      !window.confirm("删除建筑也会删除其门、楼梯、商户和关联道路。继续？")
    )
      return;
    commit(deleteEntity(doc, selected.collection, selected.id));
    setSelected(null);
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void run(save);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      } else if (e.key === "Escape") {
        setTool("select");
        setEdgeStart(null);
        setDragStart(null);
      } else if (e.key.toLowerCase() === "v") setTool("select");
      else if (e.key.toLowerCase() === "h") setTool("pan");
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const choosingCampus = mapOn && !activeFrame?.bindings.amap;
  const project = (p: Point): Point =>
    mapOn && map.current && !choosingCampus
      ? map.current.project(p)
      : [
          p[0] * view.scale + size.width / 2 + view.x,
          -p[1] * view.scale + size.height / 2 + view.y,
        ];
  const unproject = (p: Point): Point =>
    mapOn && map.current && !choosingCampus
      ? map.current.unproject(p)
      : [
          (p[0] - size.width / 2 - view.x) / view.scale,
          -(p[1] - size.height / 2 - view.y) / view.scale,
        ];
  const snapped = (p: Point): Point =>
    snap ? [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2] : p;
  const pointer = (): Point => {
    const p = stage.current!.getPointerPosition()!;
    return snapped(unproject([p.x, p.y]));
  };
  function choose(f: Feature) {
    setSelected({ collection: "features", id: f.id });
    if (f.kind === "building") {
      setBuildingId(f.id);
      setLevelId(f.levels?.[0]?.id || "");
    }
  }
  function ensureFrame(d: CamapDocument) {
    if (!d.frames.length)
      d.frames.push({
        id: uid(),
        revision: 1,
        name: "区域 1",
        unit: "m",
        bindings: {},
      });
    return d.frames.find((f) => f.id === frameId) || d.frames[0];
  }
  function place(p: Point, end?: Point) {
    if (["select", "pan", "edge"].includes(tool)) return;
    if (tool === "node") {
      const next = structuredClone(doc),
        f = ensureFrame(next),
        id = uid();
      next.nodes.push({
        id,
        revision: 1,
        frameId: f.id,
        name: "路点 " + (next.nodes.length + 1),
        position: p,
      });
      commit(next);
      setSelected({ collection: "nodes", id });
      return;
    }
    const result = addFeature(
      doc,
      tool as FeatureKind,
      p,
      end,
      building?.id,
      levels.some((l) => l.id === levelId) ? levelId : undefined,
      activeFrame?.id,
    );
    commit(result.doc);
    choose(result.feature);
    setMessage(`${labels[tool as FeatureKind]}已放置，请在右侧完善属性。`);
  }
  function nodeClick(n: RouteNode) {
    if (tool === "edge") {
      if (
        !edgeStart ||
        !doc.nodes.some((q) => q.id === edgeStart && q.frameId === n.frameId)
      ) {
        setEdgeStart(n.id);
        setMessage("选择道路的终点路点。");
      } else if (edgeStart !== n.id) {
        const next = structuredClone(doc),
          id = uid();
        next.edges.push({
          id,
          revision: 1,
          frameId: n.frameId,
          from: edgeStart,
          to: n.id,
          name: "校园步道",
          oneWay: false,
          accessible: true,
          covered: false,
          closed: false,
          points: [],
        });
        commit(next);
        setSelected({ collection: "edges", id });
        setEdgeStart(n.id);
        setMessage("道路已连接，可继续选择下一个路点。Esc 结束。");
      }
    } else setSelected({ collection: "nodes", id: n.id });
  }
  function patch(f: Partial<Feature>) {
    if (!selectedFeature) return;
    commit(updateFeature(doc, { ...selectedFeature, ...f }));
  }
  function moveFeature(f: Feature, coordinates: Point | Point[]) {
    commit(
      updateFeature(doc, {
        ...f,
        geometry: { ...f.geometry, coordinates } as Feature["geometry"],
      }),
    );
  }
  const visibleFeatures = doc.features.filter(
    (f) =>
      f.frameId === activeFrame?.id &&
      !hidden.includes(f.kind) &&
      (!f.levelId ||
        (f.buildingId === buildingId &&
          (f.levelId === levelId || f.servedLevelIds?.includes(levelId)))),
  );
  function zoom(delta: number) {
    if (mapOn) {
      map.current?.zoom(delta);
      return;
    }
    setView((v) => ({
      ...v,
      scale: Math.max(0.2, Math.min(30, v.scale * (delta > 0 ? 1.25 : 0.8))),
    }));
  }
  function reloadForCredentials() {
    try {
      localStorage.setItem(recoveryKey, JSON.stringify(latest.current));
      window.location.reload();
    } catch {
      setMapError(
        "本机配置已更新，但无法保存工程恢复副本。请先导出 .camap，再退出并重开 App 以应用配置。",
      );
    }
  }
  async function persistCredentials() {
    validateMapSettings(mapSettings);
    await saveMapCredentials(mapSettings);
    setCredentialNote("已保存到本机系统凭据库，重启后会自动回填。");
    if (mapCredentialsNeedReload(mapSettings)) {
      reloadForCredentials();
      return false;
    }
    return true;
  }
  async function saveCredentialsOnly() {
    setCredentialBusy(true);
    setMapError("");
    try {
      await persistCredentials();
    } catch (error) {
      setMapError(error instanceof Error ? error.message : String(error));
    } finally {
      setCredentialBusy(false);
    }
  }
  async function clearCredentials() {
    setCredentialBusy(true);
    setMapError("");
    try {
      await clearMapCredentials();
      const empty = emptyMapSettings();
      setMapSettings(empty);
      appliedMapSettings.current = empty;
      setMapOn(false);
      setCredentialNote("已清除本机保存的配置。");
      if (mapCredentialsNeedReload(empty)) reloadForCredentials();
    } catch (error) {
      setMapError(error instanceof Error ? error.message : String(error));
    } finally {
      setCredentialBusy(false);
    }
  }
  async function bindMap() {
    setCredentialBusy(true);
    try {
      if (!(await persistCredentials())) return;
      if (!activeFrame) {
        const next = structuredClone(doc);
        ensureFrame(next);
        commit(next);
      }
      appliedMapSettings.current = { ...mapSettings };
      setMapError("");
      setConfigOpen(false);
      setMapLoading(true);
      setMapOn(true);
      setConnectionAttempt((n) => n + 1);
      setMessage("正在连接高德地图…");
    } catch (error) {
      setMapError(error instanceof Error ? error.message : "请检查底图配置。");
    } finally {
      setCredentialBusy(false);
    }
  }
  async function findCampus(target: Basemap) {
    locationAttempt.current?.abort();
    const controller = new AbortController();
    locationAttempt.current = controller;
    setLocating(true);
    setLocationHint("正在定位当前位置…首次使用时，请在系统提示中允许定位。");
    try {
      const location = await locateCampus(controller.signal);
      if (controller.signal.aborted || map.current !== target) return;
      // Desktop fixes can be based on Wi-Fi and may be kilometres off.
      // Keep a very coarse fix from masquerading as a campus-scale location.
      if (location.accuracy && location.accuracy > 2000) {
        setLocationHint(
          "系统只给出约 " +
            Math.ceil(location.accuracy / 1000) +
            " 公里的粗略位置，未移动地图。请手动找到校园后确认。",
        );
        return;
      }
      target.focus(
        location.position,
        location.accuracy && location.accuracy > 500
          ? 14
          : location.accuracy && location.accuracy > 100
            ? 16
            : 18,
      );
      setMapTick((n) => n + 1);
      setLocationHint(
        location.approximate
          ? "已找到系统估算位置" +
            (location.accuracy
              ? "（约 " + Math.ceil(location.accuracy) + " 米误差）"
              : "") +
            "。请核对校园；可能需要拖动地图。"
          : "已定位到当前位置" +
              (location.accuracy
                ? "（约 " + Math.ceil(location.accuracy) + " 米误差）"
                : "") +
              "。确认校园位置后开始绘制。",
      );
    } catch (error) {
      if (controller.signal.aborted || map.current !== target) return;
      setLocationHint(
        (error instanceof Error
          ? error.message
          : "定位失败，请在地图上选择校园。") +
          " 当前底图视角不是已确认的当前位置。",
      );
    } finally {
      if (locationAttempt.current === controller) setLocating(false);
    }
  }
  function chooseCampusManually() {
    locationAttempt.current?.abort();
    setLocating(false);
    setLocationHint("请拖动、放大地图找到校园，再确认开始绘制。");
  }
  function useCampusCenter() {
    if (!map.current || mapLoading || locating || !choosingCampus) return;
    try {
      if (map.current.getZoom() < 16) {
        setLocationHint("请先放大地图，直到能看清校园里的建筑，再确认位置。");
        return;
      }
      const binding = map.current.getCenter();
      // React renders the newly bound features before the map effect can rebuild.
      // Make the existing adapter projectable first to avoid a render-time crash.
      map.current.setBinding(binding);
      const next = structuredClone(doc),
        frame = ensureFrame(next);
      frame.bindings.amap = binding;
      frame.revision++;
      commit(next);
      setMapLoading(true);
      setTool("select");
      setMessage("校园位置已保存，可以开始画地标了。");
    } catch {
      setLocationHint("暂时无法读取地图位置，请重新连接底图。");
    }
  }
  function connectDoor() {
    if (!selectedFeature || selectedFeature.geometry.type !== "point") return;
    const next = structuredClone(doc),
      f = next.features.find((f) => f.id === selectedFeature.id)!;
    f.exterior = true;
    const existing = next.nodes.find((n) => n.entranceId === f.id);
    if (existing) {
      setSelected({ collection: "nodes", id: existing.id });
      return;
    }
    const n: RouteNode = {
      id: uid(),
      revision: 1,
      frameId: f.frameId,
      name: f.name,
      position: selectedFeature.geometry.coordinates,
      entranceId: f.id,
    };
    next.nodes.push(n);
    commit(next);
    setSelected({ collection: "nodes", id: n.id });
    setRouteVisible(true);
    setMessage("已创建入口路点。选择「道路」将它连接到室外路网。");
  }
  const renderToken = mapTick;
  void renderToken;
  return (
    <div className="studio">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <BookOpen size={25} />
          </div>
          <div>
            <strong>万卷图</strong>
            <small>CAMPURA MAP STUDIO</small>
          </div>
        </div>
        <div className="document-heading">
          <span className="status-dot" />
          <input
            aria-label="地图名称"
            value={doc.title}
            onChange={(e) => commit({ ...doc, title: e.target.value })}
          />
          <small>自动保留本地恢复副本</small>
        </div>
        <div className="header-actions">
          <label className="theme-control">
            <span>外观</span>
            <select
              aria-label="外观主题"
              value={preference}
              onChange={(e) => setPreference(e.target.value as ThemePreference)}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <button
            onClick={() =>
              void run(async () => {
                const d = await openDocument();
                if (d) replace(d);
              })
            }
          >
            <FolderOpen size={16} />
            打开
          </button>
          <button className="primary" onClick={() => void run(save)}>
            <Download size={16} />
            导出 .camap
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="left-panel">
          <div className="section-kicker">
            地图工作室 <span>01</span>
          </div>
          <div className="panel-heading">
            <h2>把校园画得更近</h2>
            <p>从一栋楼，到一扇门。</p>
          </div>
          <div className="tool-grid">
            {tools.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={tool === id ? "active" : ""}
                aria-label={label + "工具"}
                aria-pressed={tool === id}
                onClick={() => {
                  setTool(id);
                  setEdgeStart(null);
                  setMessage(
                    id === "edge"
                      ? "依次点击两个路点，连接室外道路。"
                      : id === "pan"
                        ? "拖动画布以漫游。"
                        : `已选择${label}工具`,
                  );
                }}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="section-kicker layer-heading">
            <Layers size={14} />
            对象与图层 <span>{doc.features.length}</span>
          </div>
          <input
            className="search"
            placeholder="查找地标名称…"
            aria-label="查找地标"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="layer-toggles">
            <label>
              <input
                type="checkbox"
                checked={routeVisible}
                onChange={(e) => setRouteVisible(e.target.checked)}
              />
              室外路网
            </label>
            <label>
              <input
                type="checkbox"
                checked={!hidden.includes("area")}
                onChange={(e) =>
                  setHidden(
                    e.target.checked
                      ? hidden.filter((k) => k !== "area")
                      : [...hidden, "area"],
                  )
                }
              />
              区域
            </label>
          </div>
          <div className="object-list">
            {doc.features
              .filter(
                (f) => f.frameId === activeFrame?.id && f.name.includes(search),
              )
              .map((f) => (
                <button
                  key={f.id}
                  className={selected?.id === f.id ? "selected" : ""}
                  onClick={() => {
                    choose(f);
                    if (f.buildingId) {
                      setBuildingId(f.buildingId);
                      setLevelId(
                        f.levelId ||
                          doc.features.find((b) => b.id === f.buildingId)
                            ?.levels?.[0]?.id ||
                          "",
                      );
                    }
                    setTool("select");
                  }}
                >
                  <span
                    className="object-dot"
                    style={{ background: colors[f.kind] }}
                  />
                  <span>{f.name}</span>
                  <small>{labels[f.kind]}</small>
                </button>
              ))}
            {!doc.features.length && (
              <p className="muted">从工具栏选择建筑，在画布上拖出一个矩形。</p>
            )}
          </div>
          <div className="left-footer">
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "新建将替换当前画布，请先导出要保留的地图。继续新建？",
                  )
                )
                  replace(newDocument());
              }}
            >
              <Plus size={14} />
              新建地图
            </button>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "打开内置演示会替换当前画布，请先导出要保留的内容。继续？",
                  )
                )
                  replace(demoDocument());
              }}
            >
              演示地图
            </button>
          </div>
        </aside>
        <main className="canvas-column">
          <div className="canvas-toolbar">
            <div className="crumb">
              <span>校园地图</span>
              <ChevronRight size={14} />
              <select
                aria-label="编辑区域"
                value={activeFrame?.id || ""}
                onChange={(e) => {
                  setFrameId(e.target.value);
                  setBuildingId("");
                  setLevelId("");
                  setMapOn(false);
                }}
              >
                <option value="" disabled>
                  尚未创建区域
                </option>
                {doc.frames.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                title="添加独立区域"
                aria-label="添加独立区域"
                onClick={() => {
                  const id = uid();
                  commit({
                    ...doc,
                    frames: [
                      ...doc.frames,
                      {
                        id,
                        name: `区域 ${doc.frames.length + 1}`,
                        unit: "m",
                        bindings: {},
                        revision: 1,
                      },
                    ],
                  });
                  setFrameId(id);
                  setBuildingId("");
                  setLevelId("");
                  setMapOn(false);
                }}
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="toolbar-actions">
              <button
                title="撤销 ⌘Z"
                aria-label="撤销"
                disabled={!past.length}
                onClick={undo}
              >
                <Undo2 size={17} />
              </button>
              <button
                title="重做 ⇧⌘Z"
                aria-label="重做"
                disabled={!future.length}
                onClick={redo}
              >
                <Redo2 size={17} />
              </button>
              <i />
              <label>
                <input
                  type="checkbox"
                  checked={snap}
                  onChange={(e) => setSnap(e.target.checked)}
                />
                吸附 0.5m
              </label>
              <button onClick={() => setConfigOpen(true)}>
                <MapIcon size={16} />
                {mapOn ? "高德底图" : "设置底图"}
              </button>
            </div>
          </div>
          <div
            className={
              "canvas-wrap tool-" +
              tool +
              (choosingCampus ? " campus-pick" : "")
            }
            ref={wrapper}
            onPointerDownCapture={(e) => {
              if (
                choosingCampus &&
                locating &&
                !(e.target as HTMLElement).closest(".campus-picker")
              )
                chooseCampusManually();
            }}
            onWheelCapture={() => {
              if (choosingCampus && locating) chooseCampusManually();
            }}
          >
            <div
              className="amap-layer"
              ref={mapElement}
              style={{ display: mapOn ? "block" : "none" }}
            />
            {mapError && !configOpen && (
              <div className="map-error" role="alert">
                <span>{mapError}</span>
                <button onClick={() => setConfigOpen(true)}>设置底图</button>
                <button onClick={() => setMapError("")}>关闭提示</button>
              </div>
            )}
            {mapLoading && (
              <div className="map-loading" role="status">
                <span>正在连接高德底图…</span>
                <button
                  onClick={() => {
                    setMapOn(false);
                    setMessage("已取消连接，继续使用本地网格。");
                  }}
                >
                  取消连接
                </button>
              </div>
            )}
            {choosingCampus && !mapLoading && (
              <>
                <div className="campus-crosshair" aria-hidden="true">
                  +
                </div>
                <section className="campus-picker" aria-label="确认校园位置">
                  <strong>这是你要绘制的校园吗？</strong>
                  <p role="status">{locationHint}</p>
                  <small>
                    将校园放到十字中心并放大后确认。已有本地绘图会保留相对位置，请在绑定后核对。
                  </small>
                  <div>
                    {locating ? (
                      <button
                        onClick={() => {
                          locationAttempt.current?.abort();
                          setLocating(false);
                          setLocationHint(
                            "请拖动、放大地图找到校园，再确认开始绘制。",
                          );
                        }}
                      >
                        手动找校园
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          map.current && void findCampus(map.current)
                        }
                      >
                        重新定位
                      </button>
                    )}
                    {canOpenLocationSettings() && (
                      <button
                        onClick={() => {
                          void openLocationSettings().catch(() =>
                            setLocationHint(
                              "无法打开设置，请手动打开系统「隐私与安全性」中的定位服务。",
                            ),
                          );
                        }}
                      >
                        系统定位设置
                      </button>
                    )}
                    <button
                      className="primary"
                      disabled={locating}
                      onClick={useCampusCenter}
                    >
                      从这里开始绘制
                    </button>
                    <button onClick={() => setMapOn(false)}>
                      返回本地网格
                    </button>
                  </div>
                </section>
              </>
            )}
            {!mapOn && (
              <div
                className="paper-grid"
                style={{
                  backgroundSize: `${view.scale * 10}px ${view.scale * 10}px`,
                  backgroundPosition: `${size.width / 2 + view.x}px ${size.height / 2 + view.y}px`,
                }}
              />
            )}
            <div className="map-caption">
              <span className="map-tag">
                {mapOn ? "高德 · 二维地图" : "本地平面 · 米制坐标"}
              </span>
              <span>
                {choosingCampus
                  ? "请先确认校园位置"
                  : mapOn
                    ? "绘制内容与底图同步"
                    : "本地画布 · 可连接高德校园底图"}
              </span>
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents:
                  choosingCampus || (mapOn && tool === "pan") ? "none" : "auto",
                visibility: choosingCampus ? "hidden" : "visible",
              }}
            >
              <Stage
                width={size.width}
                height={size.height}
                ref={stage}
                listening={!mapLoading && !choosingCampus}
                draggable={!mapOn && tool === "pan"}
                onDragEnd={(e) => {
                  if (e.target === stage.current) {
                    setView((v) => ({
                      ...v,
                      x: v.x + e.target.x(),
                      y: v.y + e.target.y(),
                    }));
                    e.target.position({ x: 0, y: 0 });
                  }
                }}
                onWheel={(e) => {
                  e.evt.preventDefault();
                  zoom(e.evt.deltaY < 0 ? 1 : -1);
                }}
                onMouseMove={() => setCursor(pointer())}
                onMouseDown={(e) => {
                  if (e.target !== stage.current && tool === "select") return;
                  if (["select", "pan", "edge"].includes(tool)) {
                    if (tool === "select" && e.target === stage.current)
                      setSelected(null);
                    return;
                  }
                  setDragStart(pointer());
                }}
                onMouseUp={() => {
                  if (!dragStart) return;
                  const p = pointer(),
                    diff = Math.hypot(p[0] - dragStart[0], p[1] - dragStart[1]);
                  place(dragStart, diff > 1 ? p : undefined);
                  setDragStart(null);
                }}
              >
                <Layer>
                  {routeVisible &&
                    doc.edges
                      .filter((e) => e.frameId === activeFrame?.id)
                      .map((e) => {
                        const a = doc.nodes.find((n) => n.id === e.from),
                          b = doc.nodes.find((n) => n.id === e.to);
                        if (!a || !b) return null;
                        return (
                          <Line
                            key={e.id}
                            points={flatten(
                              [a.position, ...e.points, b.position].map(
                                project,
                              ),
                            )}
                            stroke={
                              route?.edges.includes(e.id)
                                ? palette.route
                                : e.closed
                                  ? palette.closed
                                  : selected?.id === e.id
                                    ? palette.highlighted
                                    : palette.road
                            }
                            strokeWidth={route?.edges.includes(e.id) ? 7 : 4}
                            dash={e.closed ? [6, 6] : undefined}
                            hitStrokeWidth={14}
                            onClick={(ev) => {
                              if (tool === "select") {
                                ev.cancelBubble = true;
                                setSelected({ collection: "edges", id: e.id });
                              }
                            }}
                          />
                        );
                      })}
                  {visibleFeatures.map((f) => (
                    <MapFeature
                      key={f.id}
                      feature={f}
                      theme={theme}
                      project={project}
                      unproject={unproject}
                      active={selected?.id === f.id}
                      editable={tool === "select"}
                      select={() => choose(f)}
                      change={(coords) => moveFeature(f, coords)}
                    />
                  ))}
                  {routeVisible &&
                    doc.nodes
                      .filter((n) => n.frameId === activeFrame?.id)
                      .map((n) => {
                        const [x, y] = project(n.position);
                        return (
                          <Group
                            key={n.id}
                            x={x}
                            y={y}
                            draggable={tool === "select" && !n.entranceId}
                            onClick={(e) => {
                              e.cancelBubble = true;
                              nodeClick(n);
                            }}
                            onDragEnd={(e) => {
                              const p = snapped(
                                unproject([e.target.x(), e.target.y()]),
                              );
                              commit({
                                ...doc,
                                nodes: doc.nodes.map((q) =>
                                  q.id === n.id
                                    ? {
                                        ...q,
                                        position: p,
                                        revision: q.revision + 1,
                                      }
                                    : q,
                                ),
                              });
                            }}
                          >
                            <Circle
                              radius={
                                selected?.id === n.id || edgeStart === n.id
                                  ? 7
                                  : 5
                              }
                              fill={
                                edgeStart === n.id
                                  ? palette.highlighted
                                  : palette.handle
                              }
                              stroke={palette.selected}
                              strokeWidth={2}
                            />
                          </Group>
                        );
                      })}
                  {dragStart &&
                    cursor &&
                    ["area", "building", "merchant", "room"].includes(tool) && (
                      <Line
                        points={flatten(
                          [
                            dragStart,
                            [cursor[0], dragStart[1]],
                            cursor,
                            [dragStart[0], cursor[1]],
                          ].map((p) => project(p as Point)),
                        )}
                        closed
                        fill={palette.preview}
                        stroke={palette.selected}
                        strokeWidth={1.5}
                        dash={[5, 4]}
                        listening={false}
                      />
                    )}
                </Layer>
              </Stage>
            </div>
            <div className="floor-control">
              <Building2 size={16} />
              <select
                aria-label="楼层所属建筑"
                value={buildingId}
                onChange={(e) => {
                  setBuildingId(e.target.value);
                  setLevelId(
                    doc.features.find((f) => f.id === e.target.value)
                      ?.levels?.[0]?.id || "",
                  );
                }}
              >
                <option value="">室外总览</option>
                {doc.features
                  .filter(
                    (f) =>
                      f.kind === "building" && f.frameId === activeFrame?.id,
                  )
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
              {levels.map((l) => (
                <button
                  key={l.id}
                  className={levelId === l.id ? "active" : ""}
                  onClick={() => setLevelId(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="zoom-control">
              <button aria-label="放大" onClick={() => zoom(1)}>
                <Plus size={18} />
              </button>
              <span>
                {mapOn ? "地图" : `${Math.round((view.scale * 100) / 3)}%`}
              </span>
              <button aria-label="缩小" onClick={() => zoom(-1)}>
                <Minus size={18} />
              </button>
              <button
                aria-label="回到原点"
                title="回到原点"
                onClick={() => {
                  setView({ x: 0, y: 0, scale: 3 });
                }}
              >
                <LocateFixed size={17} />
              </button>
            </div>
            {!doc.features.length && (
              <div className="canvas-empty">
                <BookOpen size={34} />
                <h2>从校园的一角开始</h2>
                <p>
                  选择左侧「建筑」，在画布上拖出轮廓。
                  <br />
                  门、楼梯和商户，都可以继续添加。
                </p>
              </div>
            )}
          </div>
          <div className="statusbar">
            <span className="status-message" role="status">
              {message}
            </span>
            <span>
              {cursor
                ? `${cursor[0].toFixed(1)}, ${cursor[1].toFixed(1)} m`
                : "选择 V · 漫游 H"}
            </span>
            <button
              className={issues.length ? "has-errors" : ""}
              onClick={() => setInspectOpen(!inspectOpen)}
            >
              <CheckCircle2 size={13} />
              {issues.length ? `${issues.length} 项需检查` : "数据检查通过"}
            </button>
          </div>
        </main>
        <aside className="right-panel">
          <div className="section-kicker">
            <Settings2 size={14} />
            属性检查器
          </div>
          {selectedFeature ? (
            <>
              <div className="inspector-title">
                <span className="kind-chip">
                  {labels[selectedFeature.kind]}
                </span>
                <button
                  aria-label="删除所选对象"
                  title="删除对象"
                  onClick={remove}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <label>
                名称
                <input
                  value={selectedFeature.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              {!["building", "area", "gate"].includes(selectedFeature.kind) && (
                <>
                  <label>
                    所属建筑
                    <select
                      value={selectedFeature.buildingId || ""}
                      onChange={(e) => {
                        const next = { ...selectedFeature };
                        delete next.levelId;
                        delete next.buildingId;
                        delete next.parentId;
                        if (e.target.value) next.buildingId = e.target.value;
                        if (next.servedLevelIds) next.servedLevelIds = [];
                        commit(updateFeature(doc, next));
                      }}
                    >
                      <option value="">室外 / 未指定</option>
                      {doc.features
                        .filter(
                          (f) =>
                            f.kind === "building" &&
                            f.frameId === selectedFeature.frameId,
                        )
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {selectedFeature.buildingId && (
                    <label>
                      显示楼层
                      <select
                        value={selectedFeature.levelId || ""}
                        onChange={(e) => {
                          const next = { ...selectedFeature };
                          if (e.target.value) next.levelId = e.target.value;
                          else delete next.levelId;
                          commit(updateFeature(doc, next));
                        }}
                      >
                        <option value="">所有楼层</option>
                        {(
                          doc.features.find(
                            (b) => b.id === selectedFeature.buildingId,
                          )?.levels || []
                        ).map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
              {selectedFeature.kind === "building" && (
                <div className="property-group">
                  <h3>楼层</h3>
                  {(selectedFeature.levels || []).map((l) => (
                    <div className="level-row" key={l.id}>
                      <input
                        aria-label="楼层名称"
                        value={l.label}
                        onChange={(e) =>
                          patch({
                            levels: selectedFeature.levels!.map((q) =>
                              q.id === l.id
                                ? { ...q, label: e.target.value }
                                : q,
                            ),
                          })
                        }
                      />
                      <button
                        title="删除楼层"
                        aria-label={"删除楼层 " + l.label}
                        onClick={() => {
                          if (
                            doc.features.some(
                              (f) =>
                                f.levelId === l.id ||
                                f.servedLevelIds?.includes(l.id),
                            )
                          ) {
                            setMessage(
                              "此楼层仍有地标或通达关系，请先修改这些关联。",
                            );
                            return;
                          }
                          patch({
                            levels: selectedFeature.levels!.filter(
                              (q) => q.id !== l.id,
                            ),
                          });
                        }}
                      >
                        <Minus size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="outline full"
                    onClick={() => {
                      const n = (selectedFeature.levels?.length || 0) + 1;
                      patch({
                        levels: [
                          ...(selectedFeature.levels || []),
                          { id: uid(), label: n + "F", ordinal: n },
                        ],
                      });
                    }}
                  >
                    <Plus size={14} />
                    添加楼层
                  </button>
                </div>
              )}
              {["stairs", "elevator"].includes(selectedFeature.kind) && (
                <div className="property-group">
                  <h3>可以通往哪些楼层</h3>
                  <p className="muted">勾选实际通达的楼层，支持跳层。</p>
                  {(
                    doc.features.find(
                      (b) => b.id === selectedFeature.buildingId,
                    )?.levels || []
                  ).map((l) => (
                    <label className="checkbox" key={l.id}>
                      <input
                        type="checkbox"
                        checked={
                          selectedFeature.servedLevelIds?.includes(l.id) ||
                          false
                        }
                        onChange={(e) =>
                          patch({
                            servedLevelIds: e.target.checked
                              ? [
                                  ...(selectedFeature.servedLevelIds || []),
                                  l.id,
                                ]
                              : (selectedFeature.servedLevelIds || []).filter(
                                  (id) => id !== l.id,
                                ),
                          })
                        }
                      />
                      {l.label}
                    </label>
                  ))}
                  {!selectedFeature.buildingId && (
                    <p className="helper">先选择所属建筑，才能设置通达楼层。</p>
                  )}
                </div>
              )}
              {["door", "gate"].includes(selectedFeature.kind) && (
                <div className="property-group">
                  <h3>出入口</h3>
                  <label>
                    属于哪个建筑 / 商户
                    <select
                      value={selectedFeature.parentId || ""}
                      onChange={(e) => {
                        const next = { ...selectedFeature };
                        if (e.target.value) next.parentId = e.target.value;
                        else delete next.parentId;
                        commit(updateFeature(doc, next));
                      }}
                    >
                      <option value="">未关联</option>
                      {doc.features
                        .filter(
                          (f) =>
                            ["building", "merchant", "room"].includes(f.kind) &&
                            f.frameId === selectedFeature.frameId,
                        )
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={selectedFeature.exterior || false}
                      onChange={(e) => {
                        if (
                          !e.target.checked &&
                          doc.nodes.some(
                            (n) => n.entranceId === selectedFeature.id,
                          )
                        ) {
                          setMessage(
                            "请先删除该入口的路网节点，再改为内部门。",
                          );
                          return;
                        }
                        patch({ exterior: e.target.checked });
                      }}
                    />
                    通向室外
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={selectedFeature.accessible || false}
                      onChange={(e) => patch({ accessible: e.target.checked })}
                    />
                    无障碍通行
                  </label>
                  <label>
                    门宽（米）
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={selectedFeature.width || ""}
                      onChange={(e) => {
                        if (Number(e.target.value) > 0)
                          patch({ width: Number(e.target.value) });
                      }}
                    />
                  </label>
                  <button className="outline full" onClick={connectDoor}>
                    <Route size={15} />
                    创建室外入口路点
                  </button>
                </div>
              )}
              {selectedFeature.geometry.type === "point" && (
                <div className="coordinate-row">
                  {(["X", "Y"] as const).map((axis, i) => (
                    <label key={axis}>
                      {axis} / 米
                      <input
                        type="number"
                        step="0.5"
                        value={
                          (selectedFeature.geometry.coordinates as Point)[i]
                        }
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const p = [
                            ...selectedFeature.geometry.coordinates,
                          ] as Point;
                          p[i] = Number(e.target.value);
                          moveFeature(selectedFeature, p);
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
              <label>
                说明
                <textarea
                  rows={3}
                  placeholder="例如：南侧入口，周一至周五开放"
                  value={selectedFeature.description || ""}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </label>
              <label>
                开放时间
                <input
                  placeholder="例如：07:00–22:00"
                  value={selectedFeature.hours || ""}
                  onChange={(e) => patch({ hours: e.target.value })}
                />
              </label>
              <div className="inspector-note">
                {selectedFeature.geometry.type === "polygon"
                  ? "拖动选框可缩放或旋转；拖动顶点可调整轮廓。"
                  : "拖动地标可改变位置。"}
                <br />
                对象 ID · {selectedFeature.id.slice(0, 8)}
              </div>
            </>
          ) : selectedNode ? (
            <>
              <h2>路网节点</h2>
              <label>
                名称
                <input
                  value={selectedNode.name}
                  onChange={(e) =>
                    commit({
                      ...doc,
                      nodes: doc.nodes.map((n) =>
                        n.id === selectedNode.id
                          ? {
                              ...n,
                              name: e.target.value,
                              revision: n.revision + 1,
                            }
                          : n,
                      ),
                    })
                  }
                />
              </label>
              <p className="muted">
                {selectedNode.entranceId
                  ? "与出入口同步移动"
                  : "室外可通行位置。选择道路工具连接路点。"}
              </p>
              <button className="danger" onClick={remove}>
                <Trash2 size={15} />
                删除节点和相连道路
              </button>
            </>
          ) : selectedEdge ? (
            <>
              <h2>校园步道</h2>
              <label>
                名称
                <input
                  value={selectedEdge.name}
                  onChange={(e) =>
                    commit({
                      ...doc,
                      edges: doc.edges.map((q) =>
                        q.id === selectedEdge.id
                          ? { ...q, name: e.target.value }
                          : q,
                      ),
                    })
                  }
                />
              </label>
              {(["oneWay", "accessible", "covered", "closed"] as const).map(
                (k, i) => (
                  <label className="checkbox" key={k}>
                    <input
                      type="checkbox"
                      checked={selectedEdge[k]}
                      onChange={(e) =>
                        commit({
                          ...doc,
                          edges: doc.edges.map((q) =>
                            q.id === selectedEdge.id
                              ? {
                                  ...q,
                                  [k]: e.target.checked,
                                  revision: q.revision + 1,
                                }
                              : q,
                          ),
                        })
                      }
                    />
                    {["单向通行", "无障碍通行", "有遮雨设施", "暂时封闭"][i]}
                  </label>
                ),
              )}
              <button className="danger" onClick={remove}>
                <Trash2 size={15} />
                删除道路
              </button>
            </>
          ) : (
            <div className="inspector-empty">
              <MousePointer2 size={28} />
              <h3>选中一个对象</h3>
              <p>
                编辑名称、所属楼层、通达关系
                <br />
                以及门和商户的关联。
              </p>
              <div className="hint-card">
                <span>开始绘制</span>
                <p>
                  矩形：按下并拖动
                  <br />
                  门与楼梯：点击放置
                  <br />
                  道路：依次点击路点
                </p>
              </div>
            </div>
          )}
          <details className="route-check">
            <summary>
              <Route size={15} />
              室外路线试算
            </summary>
            <label>
              起点
              <select
                value={routeFrom}
                onChange={(e) => setRouteFrom(e.target.value)}
              >
                <option value="">选择路点</option>
                {doc.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              终点
              <select
                value={routeTo}
                onChange={(e) => setRouteTo(e.target.value)}
              >
                <option value="">选择路点</option>
                {doc.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={accessible}
                onChange={(e) => setAccessible(e.target.checked)}
              />
              仅无障碍路线
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={preferCovered}
                onChange={(e) => setPreferCovered(e.target.checked)}
              />
              优先遮雨路线
            </label>
            {routeFrom && routeTo && (
              <p>
                {route
                  ? `路线长度 ${route.distanceMeters.toFixed(1)} 米`
                  : "两个路点之间没有可通行路线。"}
              </p>
            )}
          </details>
        </aside>
      </div>
      {inspectOpen && (
        <div className="validation-drawer">
          <button onClick={() => setInspectOpen(false)}>关闭</button>
          <h3>数据检查</h3>
          {issues.length ? (
            issues.map((i, n) => (
              <p key={n}>
                {i.message}
                <small>{i.path}</small>
              </p>
            ))
          ) : (
            <p>对象、楼层、出入口和室外路网的引用检查通过。</p>
          )}
        </div>
      )}
      {configOpen && (
        <div className="modal-backdrop">
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="map-settings-title"
          >
            <div className="section-kicker">底图设置</div>
            <h2 id="map-settings-title">连接校园地图</h2>
            <p>
              填入高德 Web JS Key
              和配套安全密钥即可。新地图会尝试定位到当前位置，你确认校园后就能开始画；已有地图直接回到保存的校园。
              无需填写经纬度。配置保存在这台电脑的系统凭据库，不写入地图文件；可随时修改或清除。
            </p>
            <fieldset
              className="credential-fields"
              disabled={!credentialsReady || credentialBusy}
            >
              {(
                [
                  ["key", "高德 Web 端（JS API）Key"],
                  ["securityCode", "配套安全密钥（本机试用）"],
                  ["proxy", "安全代理地址（可选，填写后优先使用代理）"],
                ] as const
              ).map(([k, label]) => (
                <label key={k}>
                  {label}
                  <input
                    type={
                      k === "securityCode" || k === "key" ? "password" : "text"
                    }
                    autoComplete="off"
                    spellCheck={false}
                    value={mapSettings[k]}
                    onChange={(e) =>
                      setMapSettings((s) => ({ ...s, [k]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </fieldset>
            <p role="status">{credentialNote}</p>
            <div className="credential-actions">
              <button
                disabled={!credentialsReady || credentialBusy}
                onClick={() => void saveCredentialsOnly()}
              >
                保存到本机
              </button>
              <button
                disabled={!credentialsReady || credentialBusy}
                onClick={() => void clearCredentials()}
              >
                清除本机配置
              </button>
            </div>
            {mapError && (
              <p className="settings-error" role="alert">
                {mapError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                onClick={() => {
                  setMapOn(false);
                  setMapError("");
                  setConfigOpen(false);
                }}
              >
                使用本地网格
              </button>
              <button onClick={() => setConfigOpen(false)}>取消</button>
              <button
                className="primary"
                disabled={!credentialsReady || credentialBusy}
                onClick={() => void bindMap()}
              >
                {credentialBusy ? "处理中…" : "保存并连接"}
              </button>
            </div>
            <small>
              修改已加载的凭据后，会先保留当前工程并自动重载界面，再次点击连接即可。清除配置不删除地图。电脑定位可能有偏差，可拖动地图选择校园。
            </small>
          </section>
        </div>
      )}
    </div>
  );
}

function MapFeature({
  feature: f,
  theme,
  project,
  unproject,
  active,
  editable,
  select,
  change,
}: {
  feature: Feature;
  theme: Theme;
  project: (p: Point) => Point;
  unproject: (p: Point) => Point;
  active: boolean;
  editable: boolean;
  select: () => void;
  change: (p: Point | Point[]) => void;
}) {
  const palette = canvasPalettes[theme],
    colors = palette.features;
  const ref = useRef<Konva.Line>(null),
    transformer = useRef<Konva.Transformer>(null);
  useEffect(() => {
    if (active && editable && ref.current && transformer.current) {
      transformer.current.nodes([ref.current]);
      transformer.current.getLayer()?.batchDraw();
    }
  }, [active, editable, f]);
  if (f.geometry.type === "point") {
    const [x, y] = project(f.geometry.coordinates);
    const glyph =
      (
        {
          door: "↥",
          gate: "↥",
          stairs: "≋",
          elevator: "↕",
          poi: "•",
          text: "",
        } as Record<string, string>
      )[f.kind] || "•";
    return (
      <Group
        x={x}
        y={y}
        draggable={editable}
        onClick={(e) => {
          if (editable) {
            e.cancelBubble = true;
            select();
          }
        }}
        onDragEnd={(e) => change(unproject([e.target.x(), e.target.y()]))}
      >
        {f.kind !== "text" && (
          <>
            <Circle
              radius={active ? 13 : 11}
              fill={colors[f.kind]}
              stroke={active ? palette.pointSelected : palette.pointOutline}
              strokeWidth={active ? 3 : 2}
            />
            <Text
              text={glyph}
              x={-7}
              y={-9}
              width={14}
              align="center"
              fontSize={18}
              fill={palette.glyph}
            />
          </>
        )}
        <Text
          text={f.name}
          x={f.kind === "text" ? 0 : 17}
          y={-7}
          fontSize={12}
          fill={palette.text}
          shadowColor={palette.halo}
          shadowBlur={3}
          shadowOpacity={1}
          padding={2}
        />
      </Group>
    );
  }
  const ps = f.geometry.coordinates.map(project),
    closed = f.geometry.type === "polygon",
    cx = ps.reduce((s, p) => s + p[0], 0) / ps.length,
    cy = ps.reduce((s, p) => s + p[1], 0) / ps.length;
  return (
    <>
      <Line
        ref={ref}
        points={flatten(ps)}
        closed={closed}
        fill={closed ? colors[f.kind] + "aa" : undefined}
        stroke={
          active
            ? palette.selected
            : f.kind === "area"
              ? palette.areaOutline
              : palette.outline
        }
        strokeWidth={active ? 2 : 1.5}
        draggable={editable}
        onClick={(e) => {
          if (editable) {
            e.cancelBubble = true;
            select();
          }
        }}
        onDragEnd={(e) => {
          const x = e.target.x(),
            y = e.target.y();
          e.target.position({ x: 0, y: 0 });
          change(ps.map((p) => unproject([p[0] + x, p[1] + y])));
        }}
        onTransformEnd={() => {
          const n = ref.current!,
            t = n.getTransform().copy(),
            next = ps.map(([x, y]) => {
              const p = t.point({ x, y });
              return unproject([p.x, p.y]);
            });
          n.position({ x: 0, y: 0 });
          n.scale({ x: 1, y: 1 });
          n.rotation(0);
          change(next);
        }}
      />
      <Text
        x={cx - 80}
        y={cy - 8}
        width={160}
        align="center"
        fontSize={13}
        fontStyle={f.kind === "building" ? "bold" : "normal"}
        fill={palette.text}
        shadowColor={palette.halo}
        shadowBlur={3}
        shadowOpacity={1}
        text={f.name}
        listening={false}
      />
      {active && editable && (
        <>
          <Transformer
            ref={transformer}
            flipEnabled={false}
            rotateEnabled
            keepRatio={false}
            boundBoxFunc={(old, b) =>
              Math.abs(b.width) < 8 || Math.abs(b.height) < 8 ? old : b
            }
            anchorSize={7}
            borderStroke={palette.selected}
            anchorStroke={palette.selected}
            anchorFill={palette.handle}
          />
          {ps.map(([x, y], i) => (
            <Circle
              key={i}
              x={x}
              y={y}
              radius={4}
              stroke={palette.selected}
              fill={palette.handle}
              draggable
              onDragEnd={(e) => {
                const next = [...f.geometry.coordinates] as Point[];
                next[i] = unproject([e.target.x(), e.target.y()]);
                change(next);
              }}
            />
          ))}
        </>
      )}
    </>
  );
}
