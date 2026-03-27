"use client";

import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface Area {
  id: number;
  name: string;
  color?: string;
}

type Tag = { id: number; name: string; color: string };

export function CustomerFilters({
  areas,
  currentAreas,
  currentQ,
  currentInactive,
  tags,
  currentTags,
  currentOneOff = false,
}: {
  areas: Area[];
  currentAreas: number[];
  currentQ?: string;
  currentInactive?: boolean;
  tags: Tag[];
  currentTags: number[];
  currentOneOff?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(currentQ ?? "");

  const buildUrl = (areaIds: number[], tagIds: number[], newQ?: string, newInactive?: boolean, newOneOff?: boolean) => {
    const sp = new URLSearchParams();
    if (!newOneOff && areaIds.length > 0) sp.set("areas", areaIds.join(","));
    if (tagIds.length > 0) sp.set("tags", tagIds.join(","));
    const qVal = newQ !== undefined ? newQ : q;
    if (qVal) sp.set("q", qVal);
    if (newInactive !== undefined ? newInactive : currentInactive) sp.set("inactive", "1");
    if (newOneOff ?? currentOneOff) sp.set("oneoff", "1");
    return `/customers?${sp.toString()}`;
  };

  const toggleArea = (id: number) => {
    const next = currentAreas.includes(id)
      ? currentAreas.filter((x) => x !== id)
      : [...currentAreas, id];
    router.push(buildUrl(next, currentTags, undefined, undefined, false));
  };

  const toggleTag = (id: number) => {
    const next = currentTags.includes(id)
      ? currentTags.filter((x) => x !== id)
      : [...currentTags, id];
    router.push(buildUrl(currentAreas, next));
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(buildUrl(currentAreas, currentTags, q || ""));
  };

  const hasFilters = !!(currentQ || currentAreas.length > 0 || currentInactive || currentTags.length > 0 || currentOneOff);

  return (
    <div className="space-y-2">
      {/* Search + inactive toggle + clear */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search name or address..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={() => router.push(buildUrl(currentAreas, currentTags, undefined, !currentInactive))}
          className={cn(
            "px-3 py-2 rounded-lg border text-sm font-medium flex-shrink-0 transition-colors",
            currentInactive
              ? "bg-red-100 border-red-300 text-red-700"
              : "border-slate-200 text-slate-500 hover:bg-slate-50"
          )}
        >
          {currentInactive ? "Inactive shown" : "Show inactive"}
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={() => { setQ(""); router.push("/customers"); }}
            className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50"
          >
            <X size={14} />
          </button>
        )}
      </form>

      {/* Area filters — wrapping multi-select pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => router.push(buildUrl([], currentTags, undefined, undefined, false))}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
            currentAreas.length === 0 && !currentOneOff
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-blue-50"
          )}
        >
          All areas
        </button>
        {/* One-off customer filter */}
        <button
          onClick={() => router.push(buildUrl([], currentTags, undefined, undefined, !currentOneOff))}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
            currentOneOff
              ? "bg-purple-600 text-white border-purple-600"
              : "bg-white text-purple-600 border-purple-300 hover:bg-purple-50"
          )}
        >
          One-off
        </button>
        {areas.map((a) => {
          const active = currentAreas.includes(a.id);
          const color = a.color || "#3B82F6";
          return (
            <button
              key={a.id}
              onClick={() => toggleArea(a.id)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
              style={active
                ? { backgroundColor: color, borderColor: color, color: "white" }
                : { borderColor: color + "60", color, backgroundColor: "white" }
              }
            >
              {a.name}
            </button>
          );
        })}
      </div>

      {/* Tag filters */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => {
            const active = currentTags.includes(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                style={active
                  ? { backgroundColor: tag.color, borderColor: tag.color, color: "white" }
                  : { borderColor: tag.color + "60", color: tag.color, backgroundColor: "white" }
                }
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
