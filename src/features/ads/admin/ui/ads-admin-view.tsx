"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  publishAdConfigAction,
  rollbackAdConfigAction,
  setAdsFlagAction,
  setKillAction,
  setNetworkEnabledAction,
  setPlacementEnabledAction,
} from "../actions";
import type { ActionResult } from "../contracts";
import type { AdsAdminData } from "../data";

/**
 * /admin/ads console view (AD3). Pure presentation over the server-loaded
 * read model; every control is a form posting a server action (booking
 * feature pattern), so no ad data is fetched client-side and each change
 * revalidates the page. Buttons instead of switches: no new UI dependency.
 */

const buttonClass =
  "inline-flex h-8 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const primaryButtonClass =
  "inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

function FormError({ state, testId }: { state: ActionResult | null; testId: string }) {
  const t = useTranslations("AdminAds");
  if (!state || state.ok) return null;
  return (
    <p role="alert" data-testid={testId} className="text-sm text-destructive">
      {t(`errors.${state.error}`)}
    </p>
  );
}

function ToggleForm({
  action,
  fields,
  label,
  pendingLabel,
  testId,
  primary = false,
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  testId: string;
  primary?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, formData) => action(formData),
    null,
  );
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormError state={state} testId={`${testId}-error`} />
      <button
        type="submit"
        disabled={pending}
        className={primary ? primaryButtonClass : buttonClass}
        data-testid={testId}
      >
        {pending ? pendingLabel : label}
      </button>
    </form>
  );
}

export function AdsAdminView({ data }: { data: AdsAdminData }) {
  const t = useTranslations("AdminAds");
  const latestVersion = data.versions[0]?.version ?? null;

  return (
    <div className="mt-6 grid gap-6">
      <Card data-testid="admin-flags">
        <CardHeader>
          <CardTitle>{t("sections.flags")}</CardTitle>
          <CardDescription>{t("flagsNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3">
            {data.flags.map((flag) => (
              <li
                key={flag.key}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="grid gap-1">
                  <span className="text-sm font-medium">{t(`flags.${flag.key}`)}</span>
                  <code className="text-xs text-muted-foreground">{flag.key}</code>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={flag.enabled ? "default" : "secondary"}
                    data-state={flag.enabled ? "on" : "off"}
                  >
                    {flag.enabled ? t("state.on") : t("state.off")}
                  </Badge>
                  <ToggleForm
                    action={setAdsFlagAction}
                    fields={{ key: flag.key, enabled: String(!flag.enabled) }}
                    label={flag.enabled ? t("actions.disable") : t("actions.enable")}
                    pendingLabel={t("actions.saving")}
                    testId={`admin-flag-toggle-${flag.key}`}
                    primary
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card data-testid="admin-kills">
        <CardHeader>
          <CardTitle>{t("sections.kills")}</CardTitle>
          <CardDescription>{t("killsNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3">
            <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-3">
              <div className="grid gap-1">
                <span className="text-sm font-medium">{t("kills.global")}</span>
                <span className="text-xs text-muted-foreground">{t("kills.globalHint")}</span>
              </div>
              <div className="flex items-center gap-3">
                <Badge
                  variant={data.globalKill ? "destructive" : "secondary"}
                  data-state={data.globalKill ? "killed" : "active"}
                >
                  {data.globalKill ? t("state.killed") : t("state.active")}
                </Badge>
                <ToggleForm
                  action={setKillAction}
                  fields={{ enabled: String(!data.globalKill) }}
                  label={data.globalKill ? t("actions.release") : t("actions.kill")}
                  pendingLabel={t("actions.saving")}
                  testId="admin-kill-global"
                  primary
                />
              </div>
            </li>
            {data.killNetworks.map((row) => (
              <li
                key={row.networkId ?? row.key}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="grid gap-1">
                  <span className="text-sm font-medium">{row.name}</span>
                  <code className="text-xs text-muted-foreground">{row.key}</code>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={row.killed ? "destructive" : "secondary"}
                    data-state={row.killed ? "killed" : "active"}
                  >
                    {row.killed ? t("state.killed") : t("state.active")}
                  </Badge>
                  <ToggleForm
                    action={setKillAction}
                    fields={{ networkId: row.networkId ?? "", enabled: String(!row.killed) }}
                    label={row.killed ? t("actions.release") : t("actions.kill")}
                    pendingLabel={t("actions.saving")}
                    testId={`admin-kill-network-${row.key}`}
                    primary
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card data-testid="admin-placements">
        <CardHeader>
          <CardTitle>{t("sections.placements")}</CardTitle>
          <CardDescription>{t("placementsNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.placements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty.placements")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.slot")}</TableHead>
                  <TableHead>{t("table.pageType")}</TableHead>
                  <TableHead>{t("table.network")}</TableHead>
                  <TableHead>{t("table.format")}</TableHead>
                  <TableHead>{t("table.priority")}</TableHead>
                  <TableHead>{t("table.state")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("table.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.placements.map((row) => (
                  <TableRow key={row.id} data-testid={`admin-placement-${row.id}`}>
                    <TableCell className="font-medium">
                      {row.slotKey}
                      {row.isAuth ? (
                        <Badge variant="outline" className="ml-2">
                          {t("state.authPage")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{row.pageTypeKey}</TableCell>
                    <TableCell>{row.networkName}</TableCell>
                    <TableCell>{row.formatKey}</TableCell>
                    <TableCell>{row.priority}</TableCell>
                    <TableCell>
                      <Badge
                        variant={row.enabled ? "default" : "secondary"}
                        data-state={row.enabled ? "on" : "off"}
                        data-testid={`admin-placement-state-${row.id}`}
                      >
                        {row.enabled ? t("state.on") : t("state.off")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ToggleForm
                        action={setPlacementEnabledAction}
                        fields={{ id: row.id, enabled: String(!row.enabled) }}
                        label={row.enabled ? t("actions.disable") : t("actions.enable")}
                        pendingLabel={t("actions.saving")}
                        testId={`admin-placement-toggle-${row.id}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-testid="admin-networks">
        <CardHeader>
          <CardTitle>{t("sections.networks")}</CardTitle>
          <CardDescription>{t("networksNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.networks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty.networks")}</p>
          ) : (
            <ul className="grid gap-3">
              {data.networks.map((network) => (
                <li
                  key={network.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="grid gap-1">
                    <span className="text-sm font-medium">{network.name}</span>
                    <code className="text-xs text-muted-foreground">{network.key}</code>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={network.enabled ? "default" : "secondary"}
                      data-state={network.enabled ? "on" : "off"}
                      data-testid={`admin-network-state-${network.key}`}
                    >
                      {network.enabled ? t("state.on") : t("state.off")}
                    </Badge>
                    <ToggleForm
                      action={setNetworkEnabledAction}
                      fields={{ id: network.id, enabled: String(!network.enabled) }}
                      label={network.enabled ? t("actions.disable") : t("actions.enable")}
                      pendingLabel={t("actions.saving")}
                      testId={`admin-network-toggle-${network.key}`}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card data-testid="admin-config">
        <CardHeader>
          <CardTitle>{t("sections.config")}</CardTitle>
          <CardDescription>{t("configNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span className="text-sm" data-testid="admin-config-current">
              {latestVersion === null
                ? t("state.live")
                : t("state.currentVersion", { n: latestVersion })}
            </span>
            <ToggleForm
              action={publishAdConfigAction}
              fields={{}}
              label={t("actions.publish")}
              pendingLabel={t("actions.saving")}
              testId="admin-config-publish"
              primary
            />
          </div>
          {data.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("state.noVersions")}</p>
          ) : (
            <ul className="grid gap-2">
              {data.versions.map((row) => (
                <li
                  key={row.version}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <span className="text-sm">
                    {t("state.version", { n: row.version })}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "UTC",
                      })}
                    </span>
                    {row.version === latestVersion ? (
                      <Badge className="ml-2" data-state="latest">
                        {t("state.latest")}
                      </Badge>
                    ) : null}
                  </span>
                  <ToggleForm
                    action={rollbackAdConfigAction}
                    fields={{ version: String(row.version) }}
                    label={t("actions.rollback")}
                    pendingLabel={t("actions.saving")}
                    testId={`admin-config-rollback-${row.version}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
