import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { NoteImageGallery } from "../NoteImages";
import {
  downloadExperience,
  experienceApi,
  fetchExperienceImage,
} from "../../utils/experience-client";
import type {
  ExperienceMetadata,
  ExperienceSession,
} from "../../types/experience";
import type { LibraryEntry } from "./library-shared";
import "./experience.css";
export function ExperiencePhotos({
  metadata,
}: {
  metadata?: Record<string, unknown>;
}) {
  const meta = metadata?.experience as ExperienceMetadata | undefined;
  if (!meta?.imageIds?.length) return null;
  return (
    <NoteImageGallery
      label="回忆照片"
      images={meta.imageIds.map((id, i) => ({
        id,
        name: "回忆照片 " + (i + 1),
        mime: "image/jpeg",
        size: 0,
      }))}
      loadImage={fetchExperienceImage}
    />
  );
}
export function ExperienceSnapshot({
  metadata,
}: {
  metadata?: Record<string, unknown>;
}) {
  const meta = metadata?.experience as ExperienceMetadata | undefined;
  if (!meta) return null;
  const facts = [
    [
      "时间",
      [
        meta.time.description,
        meta.time.start
          ? meta.time.start + (meta.time.end ? " 至 " + meta.time.end : "")
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    ],
    ["地点", meta.places.join(" · ")],
    ["感受", meta.impression],
    [
      "我的评分",
      meta.rating
        ? meta.rating.description ||
          String(meta.rating.value) +
            (meta.rating.scale ? "/" + meta.rating.scale : "")
        : "",
    ],
    [
      "下次意愿",
      {
        yes: "愿意再去 / 再做",
        no: "不愿意再去 / 再做",
        conditional: "有条件愿意",
        unknown: "",
      }[meta.repeatIntent],
    ],
    ["适合谁", meta.audienceNotes.join("\n")],
    ["下次留意", meta.lessons.join("\n")],
  ].filter(([, value]) => value);
  return (
    <div className="experience-memory-info">
      <dl>
        {facts.map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
      </dl>
      <ExperiencePhotos metadata={metadata} />
    </div>
  );
}
export function ExperienceDetails({
  entry,
  onChanged,
}: {
  entry: LibraryEntry;
  onChanged: () => void;
}) {
  const [session, setSession] = useState<ExperienceSession | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    navigate = useNavigate();
  useEffect(() => {
    let active = true;
    void experienceApi("/entry/" + entry.id)
      .then((s) => {
        if (active) setSession(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [entry.id, entry.updatedAt]);
  const meta = entry.metadata?.experience as ExperienceMetadata | undefined;
  const lifecycle = async (action: "archive" | "restore" | "purge") => {
    if (!session || busy) return;
    if (
      !window.confirm(
        action === "purge"
          ? "永久删除这条经历、全部复盘和照片？此操作无法撤回。"
          : action === "archive"
            ? "将这条经历移入已归档？"
            : "恢复这条经历？",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const current = await experienceApi("/" + session.id);
      await experienceApi("/" + session.id + "/lifecycle", "POST", {
        expectedRevision: current.revision,
        action,
        confirm: true,
      });
      if (action === "purge") navigate("/library");
      else onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="experience-memory-info">
      <div className="experience-actions">
        {session && entry.status === "active" && (
          <Link
            className="library-secondary-button"
            to={"/library/experience/" + session.id}
          >
            编辑 / 继续复盘
          </Link>
        )}
        <button
          className="library-secondary-button"
          disabled={busy || !session}
          onClick={() => {
            if (!session) return;
            setBusy(true);
            void downloadExperience(session.id)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          导出完整经历
        </button>
        <button
          className="library-secondary-button"
          disabled={busy || !session}
          onClick={() =>
            void lifecycle(entry.status === "archived" ? "restore" : "archive")
          }
        >
          {entry.status === "archived" ? "恢复经历" : "归档经历"}
        </button>
        {entry.status === "archived" && (
          <button
            className="library-danger-button"
            disabled={busy || !session}
            onClick={() => void lifecycle("purge")}
          >
            永久删除
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="orbit-inline-error">
          {error}
        </p>
      )}
      {meta && (
        <dl>
          {meta.time.description && (
            <>
              <dt>时间</dt>
              <dd>
                {meta.time.description}
                {meta.time.start && (
                  <small>
                    {" "}
                    · {meta.time.start}
                    {meta.time.end ? " 至 " + meta.time.end : ""}
                  </small>
                )}
              </dd>
            </>
          )}
          {meta.places.length > 0 && (
            <>
              <dt>地点</dt>
              <dd>{meta.places.join(" · ")}</dd>
            </>
          )}
          {meta.impression && (
            <>
              <dt>感受</dt>
              <dd>{meta.impression}</dd>
            </>
          )}
          {meta.rating && (
            <>
              <dt>我的评分</dt>
              <dd>
                {meta.rating.description ||
                  `${meta.rating.value}${meta.rating.scale ? "/" + meta.rating.scale : ""}`}
              </dd>
            </>
          )}
          {meta.repeatIntent !== "unknown" && (
            <>
              <dt>下次意愿</dt>
              <dd>
                {
                  {
                    yes: "愿意再去 / 再做",
                    no: "不愿意再去 / 再做",
                    conditional: "有条件愿意",
                  }[meta.repeatIntent]
                }
              </dd>
            </>
          )}
          {meta.audienceNotes.length > 0 && (
            <>
              <dt>适合谁</dt>
              <dd>{meta.audienceNotes.join("\n")}</dd>
            </>
          )}
          {meta.lessons.length > 0 && (
            <>
              <dt>下次留意</dt>
              <dd>{meta.lessons.join("\n")}</dd>
            </>
          )}
        </dl>
      )}
      <ExperiencePhotos metadata={entry.metadata} />
      {session && (
        <details className="experience-transcript">
          <summary>原始复盘 · {session.data.messages.length} 条问答</summary>
          {session.data.messages.map((m, i) => (
            <div key={i}>
              <strong>{m.role === "user" ? "我的原话" : "复盘助手"}</strong>
              <p>{m.text}</p>
            </div>
          ))}
          {session.data.lookups.map((lookup, i) => (
            <details key={i}>
              <summary>
                联网核查记录 · {new Date(lookup.at).toLocaleString()}
              </summary>
              <p>{lookup.reply}</p>
              {lookup.sources
                .filter((s) => /^https:\/\//.test(s.url))
                .map((s) => (
                  <p key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>{" "}
                    · {s.source}
                  </p>
                ))}
            </details>
          ))}
        </details>
      )}
    </section>
  );
}
