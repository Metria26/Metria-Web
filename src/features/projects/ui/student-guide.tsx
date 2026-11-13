"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeftIcon, ArrowRightIcon, CircleHelpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const STORAGE_PREFIX = "metria.project-guide.v1";

/**
 * Five-step student walkthrough of the group/project flow. Auto-opens on the
 * Projects hub for students who have not seen it (per profile, per browser);
 * the launcher stays on every Projects page so it can be reopened at any time.
 */
export function StudentProjectGuide({
  profileId,
  autoOpen,
}: {
  profileId: string;
  autoOpen: boolean;
}) {
  const t = useTranslations("Projects.guide");
  const pathname = usePathname();
  const storageKey = `${STORAGE_PREFIX}:${profileId}`;
  const [open, setOpen] = useState(() => {
    if (!autoOpen || pathname !== "/app/projects" || typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(storageKey) === null;
    } catch {
      // Storage can be blocked (private mode); still show the walkthrough once.
      return true;
    }
  });
  const [index, setIndex] = useState(0);

  const slides = [
    {
      src: "/projects-guide/00_SELECT_PROJECT.png",
      width: 1312,
      height: 722,
      copy: "select",
      warning: false,
    },
    {
      src: "/projects-guide/01_ADD_GROUP.png",
      width: 1312,
      height: 721,
      copy: "group",
      warning: true,
    },
    {
      src: "/projects-guide/02_ADD_PROJECT_DETAILS.png",
      width: 1314,
      height: 719,
      copy: "details",
      warning: false,
    },
    {
      src: "/projects-guide/03_SUBMIT_DETAILS.png",
      width: 1313,
      height: 721,
      copy: "submit",
      warning: false,
    },
    {
      src: "/projects-guide/04_VERIFY_SUBMISSION_ADDED.png",
      width: 1314,
      height: 723,
      copy: "verify",
      warning: false,
    },
  ] as const;

  const lastIndex = slides.length - 1;
  const slide = slides[index] ?? slides[0];

  useEffect(() => {
    if (!open) return;
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Nothing to persist; the guide still works for this session.
    }
  }, [open, storageKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setIndex((current) => Math.min(current + 1, lastIndex));
      if (event.key === "ArrowLeft") setIndex((current) => Math.max(current - 1, 0));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, lastIndex]);

  const openGuide = () => {
    setIndex(0);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={openGuide}
        title={t("launcherTitle")}
        className="fixed right-4 bottom-4 z-40 inline-flex h-10 items-center gap-2 rounded-full border border-input bg-background/95 px-4 text-sm font-medium shadow-lg backdrop-blur transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        data-testid="project-guide-launcher"
      >
        <CircleHelpIcon className="size-4" />
        {t("openButton")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <header className="grid gap-1 pr-8">
            <DialogTitle className="text-lg font-semibold">{t("title")}</DialogTitle>
            <DialogDescription>
              {t("step", { current: index + 1, total: slides.length })}
            </DialogDescription>
          </header>

          <div className="grid gap-3" data-testid="project-guide-slide">
            <h3 className="text-base font-semibold">{t(`slides.${slide.copy}.title`)}</h3>

            {slide.warning ? (
              <p
                role="alert"
                data-testid="project-guide-leader-warning"
                className="rounded-lg border-2 border-destructive bg-destructive/15 p-3 text-sm font-extrabold tracking-wide text-destructive uppercase"
              >
                {t("leaderWarning")}
              </p>
            ) : null}

            <div className="overflow-hidden rounded-lg border bg-muted/20">
              <Image
                src={slide.src}
                alt={t(`slides.${slide.copy}.alt`)}
                width={slide.width}
                height={slide.height}
                sizes="(max-width: 1024px) 100vw, 960px"
                className="h-auto w-full"
              />
            </div>

            <p className="text-sm leading-relaxed whitespace-pre-line">
              {t(`slides.${slide.copy}.body`)}
            </p>

            <p className="rounded-lg border border-warning/60 bg-warning/15 px-3 py-2 text-sm font-semibold text-foreground">
              {t("highlightPrefix")} {t(`slides.${slide.copy}.highlight`)}
            </p>
          </div>

          <footer className="flex items-center justify-between gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              disabled={index === 0}
              data-testid="project-guide-prev"
            >
              <ArrowLeftIcon />
              {t("prev")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {index + 1} / {slides.length}
            </span>
            <Button
              type="button"
              onClick={() => {
                if (index === lastIndex) {
                  setOpen(false);
                  return;
                }
                setIndex(index + 1);
              }}
              data-testid="project-guide-next"
            >
              {index === lastIndex ? t("done") : t("next")}
              <ArrowRightIcon />
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  );
}
