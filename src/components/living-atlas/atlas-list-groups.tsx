import type { ReactNode } from "react";
import {
  groupByPlaceAndSystem,
  isUnknownPlace,
  systemLabel,
  type PlaceKind,
  type SystemKind,
} from "@/lib/atlas-taxonomy";

/** ばしょ × 系統でグルーピング。未特定は末尾の「霧」帯にまとめる */
export function AtlasGroupedList<T>({
  items,
  getPlace,
  getSystem,
  getKey,
  renderItem,
  empty,
  unknownHint,
}: {
  items: T[];
  getPlace: (item: T) => PlaceKind;
  getSystem: (item: T) => SystemKind;
  getKey: (item: T) => string;
  renderItem: (item: T, indexInGroup: number) => ReactNode;
  empty?: ReactNode;
  /** 霧帯の下に出す短い案内 */
  unknownHint?: ReactNode;
}) {
  if (items.length === 0) {
    return <>{empty ?? null}</>;
  }

  const groups = groupByPlaceAndSystem(items, getPlace, getSystem);
  const known = groups.filter((g) => !isUnknownPlace(g.place));
  const unknownItems = groups
    .filter((g) => isUnknownPlace(g.place))
    .flatMap((g) => g.items);

  return (
    <div className="grid gap-4">
      {known.map((g) => (
        <section key={`${g.place.key}::${g.system}`}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="m-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#f0d25a]">
              {g.place.label}
            </h3>
            <span className="font-[family-name:var(--font-pixel)] text-[9px] text-[#c9c3a0]">
              × {systemLabel(g.system)}
            </span>
            <span className="text-[11px] text-[#c9c3a0]">{g.items.length}</span>
          </div>
          <ul className="m-0 list-none border-t-2 border-[#002070] p-0">
            {g.items.map((item, i) => (
              <li key={getKey(item)}>{renderItem(item, i)}</li>
            ))}
          </ul>
        </section>
      ))}

      {unknownItems.length > 0 ? (
        <section className="border-[3px] border-dashed border-[#4a6080] bg-[#00081f] p-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="m-0 font-[family-name:var(--font-pixel)] text-[10px] text-[#9ec0ff]">
              ◆ 未特定（霧）
            </h3>
            <span className="text-[11px] text-[#c9c3a0]">{unknownItems.length} 件</span>
          </div>
          <p className="m-0 mb-2 text-[12px] leading-relaxed text-[#c9c3a0]">
            {unknownHint ??
              "ばしょがまだ付いていないぞ。MCP の enrich_gate_places か、出題時の domain / repo で特定できる。"}
          </p>
          <ul className="m-0 list-none border-t-2 border-[#002070] p-0 opacity-90">
            {unknownItems.map((item, i) => (
              <li key={getKey(item)}>
                {renderItem(item, i)}
                <p className="mt-0 mb-2 pl-8 text-[10px] text-[#6a7a9a]">
                  系統: {systemLabel(getSystem(item))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
