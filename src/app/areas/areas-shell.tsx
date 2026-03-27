"use client";

import { useState } from "react";
import { LayoutList, Users } from "lucide-react";
import { AreasClient } from "./areas-client";
import { AreaManage } from "./area-manage";

type Area = {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  scheduleType: string;
  frequencyWeeks: number;
  monthlyDay: number | null;
  nextDueDate: Date | string | null;
  estimatedValue: number;
  _count: { customers: number };
  customers: { id: number; name: string; address: string; price: number; sortOrder: number }[];
};

type Customer = {
  id: number;
  name: string;
  address: string;
  areaId: number;
  price: number;
  area: { id: number; name: string } | null;
};

type Tab = "manage" | "assign";

const TABS: { id: Tab; label: string; Icon: React.FC<{ size?: number; className?: string }> }[] = [
  { id: "manage", label: "Area Settings", Icon: LayoutList },
  { id: "assign", label: "Assign Customers", Icon: Users },
];

export function AreasShell({
  customers,
  areas,
  hidePrices = false,
}: {
  customers: Customer[];
  areas: Area[];
  hidePrices?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("manage");

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Areas</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage your service areas and assign customers to them.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "manage" && <AreaManage areas={areas} />}
        {tab === "assign" && <AreasClient customers={customers} areas={areas} hidePrices={hidePrices} />}
      </div>
    </div>
  );
}
