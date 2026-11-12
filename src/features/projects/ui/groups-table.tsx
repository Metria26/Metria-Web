"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { GROUP_STATUSES } from "../contracts";
import { GroupStatusBadge, SubmissionStatusBadge } from "./status-badge";

export type GroupRow = {
  id: string;
  group_id: string;
  project_title: string;
  status: string;
  submission_status: string;
  submitted_at: string | null;
  leader_name: string;
  member_count: number;
  member_names: string;
  archived_at: string | null;
};

const PAGE_SIZE = 10;
const buttonClass =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const outlineButtonClass =
  "inline-flex h-9 items-center justify-center rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const inputClass =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";

/**
 * TA group table (prompt 7): search, sort, filter and paginate every group on
 * the dashboard, with multi-select driven Excel export (all / selected /
 * filtered — the export route covers "by course/section/dashboard" through the
 * dashboard scope).
 */
export function GroupsTable({ dashboardId, groups }: { dashboardId: string; groups: GroupRow[] }) {
  const t = useTranslations("Projects");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sortKey, setSortKey] = useState<"group_id" | "submitted_at" | "status">("group_id");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = groups.filter((group) => {
      if (status !== "all" && group.status !== status) return false;
      if (needle.length === 0) return true;
      return (
        group.group_id.toLowerCase().includes(needle) ||
        group.project_title.toLowerCase().includes(needle) ||
        group.member_names.toLowerCase().includes(needle) ||
        group.leader_name.toLowerCase().includes(needle)
      );
    });
    return rows.sort((a, b) => {
      if (sortKey === "submitted_at") {
        return (b.submitted_at ?? "").localeCompare(a.submitted_at ?? "");
      }
      if (sortKey === "status")
        return a.status.localeCompare(b.status) || a.group_id.localeCompare(b.group_id);
      return a.group_id.localeCompare(b.group_id);
    });
  }, [groups, query, status, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const exportHref = (ids: string[]) => {
    const params = new URLSearchParams({ dashboardId });
    if (ids.length > 0) params.set("groupIds", ids.join(","));
    return `/api/projects/export?${params.toString()}`;
  };

  const toggleSelected = (groupId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const formatDateTime = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(value),
        )
      : "—";

  return (
    <div className="grid gap-4" data-testid="groups-table">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder={t("groups.searchPlaceholder")}
          className={`${inputClass} max-w-72`}
          data-testid="groups-search"
        />
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(0);
          }}
          className={`${inputClass} max-w-48`}
          data-testid="groups-status-filter"
        >
          <option value="all">{t("groups.allStatuses")}</option>
          {GROUP_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`statuses.group.${value}`)}
            </option>
          ))}
        </select>
        <select
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as typeof sortKey)}
          className={`${inputClass} max-w-48`}
          data-testid="groups-sort"
        >
          <option value="group_id">{t("groups.sortGroupId")}</option>
          <option value="submitted_at">{t("groups.sortSubmitted")}</option>
          <option value="status">{t("groups.sortStatus")}</option>
        </select>
        <div className="ms-auto flex items-center gap-2">
          <a className={outlineButtonClass} href={exportHref([])} data-testid="export-all">
            {t("groups.exportAll")}
          </a>
          <a
            className={buttonClass}
            href={exportHref(Array.from(selected))}
            data-testid="export-selected"
            aria-disabled={selected.size === 0}
          >
            {t("groups.exportSelected", { count: selected.size })}
          </a>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-start text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-start">{t("groups.columnGroup")}</th>
              <th className="p-3 text-start">{t("groups.columnTitle")}</th>
              <th className="p-3 text-start">{t("groups.columnMembers")}</th>
              <th className="p-3 text-start">{t("groups.columnStatus")}</th>
              <th className="p-3 text-start">{t("groups.columnSubmitted")}</th>
              <th className="p-3 text-start" aria-label={t("groups.selectColumn")} />
            </tr>
          </thead>
          <tbody>
            {visible.map((group) => (
              <tr key={group.id} className="border-t align-middle">
                <td className="p-3 font-mono text-xs" data-testid={`group-id-${group.group_id}`}>
                  {group.group_id}
                </td>
                <td className="p-3">
                  <Link
                    href={`/app/projects/${dashboardId}/groups/${group.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {group.project_title || "—"}
                  </Link>
                </td>
                <td className="p-3">
                  <span className="block text-xs">
                    {t("groups.memberCount", { count: group.member_count })} ·{" "}
                    {group.leader_name || "—"}
                  </span>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    <GroupStatusBadge
                      status={group.status as never}
                      label={t(`statuses.group.${group.status}`)}
                    />
                    <SubmissionStatusBadge
                      status={group.submission_status as never}
                      label={t(`statuses.submission.${group.submission_status}`)}
                    />
                  </div>
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {formatDateTime(group.submitted_at)}
                </td>
                <td className="p-3 text-end">
                  <input
                    type="checkbox"
                    checked={selected.has(group.id)}
                    onChange={() => toggleSelected(group.id)}
                    aria-label={t("groups.selectRow", { id: group.group_id })}
                    data-testid={`select-group-${group.group_id}`}
                  />
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-sm text-muted-foreground">
                  {t("groups.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {t("groups.pageCount", { page: safePage + 1, total: pageCount, count: filtered.length })}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className={outlineButtonClass}
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            {t("groups.prev")}
          </button>
          <button
            type="button"
            className={outlineButtonClass}
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            {t("groups.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
