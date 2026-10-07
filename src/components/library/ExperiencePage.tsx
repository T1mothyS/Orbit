import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { NoteImageGallery, NoteImageInput } from '../NoteImages';
import { blobDataUrl } from '../../utils/note-image-client';
import {
  NOTE_IMAGE_MAX_BYTES,
  NOTE_IMAGES_MAX_BYTES,
  NOTE_IMAGE_TYPES,
} from '../../utils/note-images';
import {
  composerDraftKey,
  consumeComposerDraft,
  readComposerDraft,
  snapshotComposerDraft,
  updateComposerDraft,
} from '../../utils/composer-draft';
import {
  experienceApi,
  fetchExperienceImage,
  retainExperienceImage,
} from '../../utils/experience-client';
import {
  emptyExperience,
  type ExperienceDraft,
  type ExperienceSession,
} from '../../types/experience';
import './experience.css';
export function ExperiencePage() {
  const { sessionId } = useParams();
  return sessionId ? (
    <ExperienceEditor key={sessionId} id={sessionId} />
  ) : (
    <ExperienceHome />
  );
}
function ExperienceHome() {
  const navigate = useNavigate(),
    [items, setItems] = useState<
      Array<{
        id: string;
        title: string;
        updatedAt: string;
      }>
    >([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = useCallback(
    () =>
      experienceApi()
        .then((data) => setItems(data.items))
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="library-page experience-page">
      <div className="experience-shell">
        <Link className="library-back-button" to="/library">
          ← 知识库
        </Link>
        <header>
          <h1>记录经历</h1>
          <p>聊聊一次旅行或一段值得留住的经历，整理成自己的回忆。</p>
        </header>
        <button
          className="library-primary-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void experienceApi('', 'POST', { requestId: crypto.randomUUID() })
              .then((s) => navigate('/library/experience/' + s.id))
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          开始一条新经历
        </button>
        {error && (
          <p role="alert" className="orbit-inline-error">
            {error}
            <button onClick={() => void load()}>重试</button>
          </p>
        )}
        <section className="experience-resumes">
          <h2>未完成的复盘</h2>
          {items.length ? (
            items.map((item) => (
              <Link key={item.id} to={'/library/experience/' + item.id}>
                <strong>{item.title}</strong>
                <span>{new Date(item.updatedAt).toLocaleString()}</span>
              </Link>
            ))
          ) : (
            <p>没有未完成的复盘。随时离开，已发送的原话和草稿会自动保留。</p>
          )}
        </section>
      </div>
    </div>
  );
}
function ExperienceEditor({ id }: { id: string }) {
  const { user } = useAuth(),
    navigate = useNavigate();
  const [session, setSession] = useState<ExperienceSession | null>(null),
    [draft, setDraft] = useState<ExperienceDraft | null>(null),
    [text, setText] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [provider, setProvider] = useState<'chatgpt' | 'workbuddy'>('chatgpt'),
    [model, setModel] = useState(''),
    [models, setModels] = useState<
      Array<{
        id: string;
        name: string;
      }>
    >([]),
    [modelError, setModelError] = useState(''),
    [modelReload, setModelReload] = useState(0);
  const dirty = useRef(false),
    localDraft = useRef(draft),
    alive = useRef(true),
    lock = useRef(false),
    fileInput = useRef<HTMLInputElement>(null);
  localDraft.current = draft;
  const key = user ? composerDraftKey(user.id, 'experience:' + id) : '';
  const editorKey = user
    ? composerDraftKey(user.id, 'experience-editor:' + id)
    : '';
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const accept = useCallback((s: ExperienceSession) => {
    if (!alive.current) return;
    setSession(s);
    if (!dirty.current) setDraft(s.data.draft);
  }, []);
  const load = useCallback(async () => {
    const s = await experienceApi('/' + id);
    accept(s);
    return s as ExperienceSession;
  }, [id, accept]);
  useEffect(() => {
    if (!key) return;
    setText(readComposerDraft(key).text);
    const saved = readComposerDraft(editorKey).text;
    if (saved) {
      try {
        const value = JSON.parse(saved);
        setDraft(value);
        dirty.current = true;
      } catch {}
    }
    void load()
      .then((s) => {
        if (s.data.selection) {
          setProvider(s.data.selection.provider);
          setModel(s.data.selection.model);
        }
      })
      .catch((e) => setError(e.message));
  }, [key, editorKey, load]);
  useEffect(() => {
    let active = true;
    setModels([]);
    setModelError('');
    void experienceApi('/models/' + provider)
      .then((data) => {
        if (!active) return;
        setModels(data.models);
        setModel(
          (previous) =>
            previous ||
            data.models.find((m: any) => /luna/i.test(m.name + ' ' + m.id))
              ?.id ||
            (provider === 'workbuddy'
              ? data.models.find((m: any) => /glm/i.test(m.id))?.id
              : '') ||
            '',
        );
      })
      .catch((e) => {
        if (active) setModelError(e.message);
      });
    return () => {
      active = false;
    };
  }, [provider, modelReload]);
  useEffect(() => {
    if (session?.state !== 'generating') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await experienceApi('/' + id);
        if (active) accept(s);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
      if (active) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 700);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [session?.state, id, accept]);
  const changeText = (value: string) => {
    setText(value);
    if (key) updateComposerDraft(key, { text: value });
  };
  const changeDraft = (value: ExperienceDraft) => {
    dirty.current = true;
    setDraft(value);
    if (editorKey)
      updateComposerDraft(editorKey, { text: JSON.stringify(value) });
  };
  const perform = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        void load().catch(() => {});
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const run = (finish = false, override?: string) =>
    perform(async () => {
      if (!session) return;
      const current = dirty.current && draft ? await save() : session;
      const snap = key ? snapshotComposerDraft(key) : null;
      const s = await experienceApi('/' + id + '/run', 'POST', {
        requestId: crypto.randomUUID(),
        expectedRevision: current.revision,
        text: override ?? text,
        finish,
        provider,
        model,
      });
      accept(s);
      if (snap && override === undefined) {
        consumeComposerDraft(snap, false);
        if (alive.current) setText(readComposerDraft(key).text);
      }
    });
  const save = async () => {
    if (!session || !draft) throw new Error('请先整理草稿');
    if (!draft.title.trim() || !draft.content.trim())
      throw new Error('请填写标题和正文后再保存');
    const value = draft;
    const s = await experienceApi('/' + id, 'PATCH', {
      expectedRevision: session.revision,
      draft: value,
    });
    if (localDraft.current === value) {
      dirty.current = false;
      updateComposerDraft(editorKey, { text: '' });
    }
    accept(s);
    return s as ExperienceSession;
  };
  const generating = session?.state === 'generating',
    disabled = busy || generating,
    modelUsable = models.some((m) => m.id === model);
  const addImages = (files: File[]) =>
    perform(async () => {
      if (!session) return;
      let current = session;
      if (
        current.images.length + files.length > 3 ||
        current.images.reduce((a, b) => a + b.size, 0) +
          files.reduce((a, b) => a + b.size, 0) >
          NOTE_IMAGES_MAX_BYTES
      )
        throw new Error('最多3张照片，合计不超过20MB');
      for (const file of files) {
        if (
          !NOTE_IMAGE_TYPES.includes(file.type as any) ||
          !file.size ||
          file.size > NOTE_IMAGE_MAX_BYTES
        )
          throw new Error('请选择10MB以内的JPEG、PNG或WebP');
        const base64 = (await blobDataUrl(file)).split(',')[1];
        const result = await experienceApi('/' + id + '/images', 'POST', {
          requestId: crypto.randomUUID(),
          expectedRevision: current.revision,
          name: file.name,
          mime: file.type,
          base64,
        });
        current = result.session;
        accept(current);
      }
    });
  if (!session)
    return (
      <div className="library-page experience-page">
        <Link to="/library/experience">← 记录经历</Link>
        <p role={error ? 'alert' : 'status'}>{error || '正在读取经历…'}</p>
        {error && (
          <button
            className="library-secondary-button"
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            重试
          </button>
        )}
      </div>
    );
  const latestLookup = session.data.lookups.at(-1);
  return (
    <div className="library-page experience-page">
      <div className="experience-shell">
        <Link className="library-back-button" to="/library/experience">
          ← 记录经历
        </Link>
        <header>
          <h1>{session.entryId ? '继续复盘' : '留住一段经历'}</h1>
          <p>原话自动保留。照片只用来回忆，最多3张。</p>
          {session.entryId && (
            <Link to={'/library/' + session.entryId}>查看已保存的经历</Link>
          )}
        </header>
        {(error || session.data.error) && (
          <p className="orbit-inline-error" role="alert">
            {error || session.data.error}
          </p>
        )}
        {session.data.error && !generating && (
          <button
            className="library-secondary-button"
            disabled={busy || !modelUsable}
            onClick={() => void run(true)}
          >
            重试整理
          </button>
        )}
        <div className={'experience-layout' + (draft ? ' has-preview' : '')}>
          <section className="experience-conversation" aria-label="经历复盘">
            <div className="experience-messages">
              {session.data.messages.length ? (
                session.data.messages.map((m, i) => (
                  <div className={'experience-message ' + m.role} key={i}>
                    <span>{m.role === 'user' ? '我的原话' : '复盘助手'}</span>
                    <p>{m.text}</p>
                  </div>
                ))
              ) : (
                <div className="experience-empty">
                  <h2>从你记得的事情开始</h2>
                  <p>
                    去了哪里、什么让你印象深刻，或有什么遗憾，都可以。时间记不清也没关系。
                  </p>
                </div>
              )}
            </div>
            {latestLookup && (
              <details className="experience-lookup" open>
                <summary>联网核查 · 待你确认</summary>
                <p>{latestLookup.reply}</p>
                {latestLookup.sources
                  .filter((s) => /^https:\/\//.test(s.url))
                  .map((s) => (
                    <a
                      key={s.url}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.title} · {s.source}
                    </a>
                  ))}
                <p>只有确认符合当时的经历，才会用于正式记录。</p>
                <button
                  className="library-secondary-button"
                  disabled={disabled || !modelUsable}
                  onClick={() =>
                    void run(
                      false,
                      '我确认以下核查候选信息符合我的这次经历：' +
                        latestLookup.reply.slice(0, 10000),
                    )
                  }
                >
                  符合我的记忆
                </button>
                <span>也可以在下面补充或纠正。</span>
              </details>
            )}
            {generating && (
              <p role="status">
                {session.data.steps.at(-1)?.label || '正在整理经历…'}
              </p>
            )}
            <div className="experience-composer">
              <label htmlFor="experience-input">
                {session.data.messages.length ? '补充你的回忆' : '说说这段经历'}
              </label>
              <textarea
                id="experience-input"
                value={text}
                maxLength={20000}
                placeholder="例如：上周末去了海边，日落很美，但回程堵了很久，下次想早点出发。"
                onChange={(e) => changeText(e.target.value)}
              />
              <div className="experience-models">
                <label>
                  模型来源
                  <select
                    value={provider}
                    disabled={disabled}
                    onChange={(e) => {
                      setProvider(e.target.value as typeof provider);
                      setModel('');
                    }}
                  >
                    <option value="chatgpt">ChatGPT</option>
                    <option value="workbuddy">WorkBuddy</option>
                  </select>
                </label>
                <label>
                  本次模型
                  <select
                    value={model}
                    disabled={disabled || !models.length}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="">
                      {models.length ? '请选择模型' : '暂无可用模型'}
                    </option>
                    {model && !modelUsable && (
                      <option value={model}>
                        {model}（已不可用，请重新选择）
                      </option>
                    )}
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {modelError && (
                <p role="alert">
                  模型加载失败：{modelError}。仍可按原话整理。
                  <button
                    type="button"
                    className="library-inline-button"
                    disabled={disabled}
                    onClick={() => setModelReload((v) => v + 1)}
                  >
                    重试模型列表
                  </button>
                </p>
              )}
              <div className="experience-actions">
                <button
                  className="library-primary-button"
                  disabled={disabled || !text.trim() || !modelUsable}
                  onClick={() => void run()}
                >
                  继续复盘
                </button>
                <button
                  className="library-secondary-button"
                  disabled={
                    disabled ||
                    !modelUsable ||
                    (!text.trim() && !session.data.messages.length)
                  }
                  onClick={() => void run(true)}
                >
                  直接整理 / 跳过追问
                </button>
                {generating && (
                  <button
                    className="library-secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () =>
                        accept(
                          await experienceApi('/' + id + '/cancel', 'POST', {
                            expectedRevision: session.revision,
                          }),
                        ),
                      )
                    }
                  >
                    停止整理
                  </button>
                )}
                <button
                  className="library-secondary-button"
                  disabled={
                    disabled || (!text.trim() && !session.data.messages.length)
                  }
                  onClick={() => {
                    void perform(async () => {
                      const snap = snapshotComposerDraft(key);
                      const s = await experienceApi(
                        '/' + id + '/original',
                        'POST',
                        { expectedRevision: session.revision, text },
                      );
                      dirty.current = false;
                      updateComposerDraft(editorKey, { text: '' });
                      accept(s);
                      consumeComposerDraft(snap, false);
                      setText(readComposerDraft(key).text);
                    });
                  }}
                >
                  按原话整理
                </button>
              </div>
            </div>
            <div className="experience-photos">
              <NoteImageGallery
                label="回忆照片"
                images={session.images}
                editable
                disabled={disabled}
                loadImage={fetchExperienceImage}
                removeImage={retainExperienceImage}
                onChange={(images) => {
                  void perform(async () =>
                    accept(
                      await experienceApi('/' + id, 'PATCH', {
                        expectedRevision: session.revision,
                        imageIds: images.map((i) => i.id),
                      }),
                    ),
                  );
                }}
              />
              <NoteImageInput
                inputRef={fileInput}
                disabled={disabled}
                onFiles={(files) => void addImages(files)}
              />
              <button
                className="library-secondary-button"
                disabled={disabled || session.images.length >= 3}
                onClick={() => fileInput.current?.click()}
              >
                添加回忆照片
              </button>
            </div>
          </section>
          {draft && (
            <section className="experience-preview" aria-label="经历保存预览">
              <h2>保存预览</h2>
              <p>核对和修改后，确认保存到知识库。</p>
              <DraftEditor
                draft={draft}
                onChange={changeDraft}
                disabled={generating}
              />
              <div className="experience-actions">
                <button
                  className="library-secondary-button"
                  disabled={disabled}
                  onClick={() =>
                    void perform(async () => {
                      await save();
                    })
                  }
                >
                  保留草稿
                </button>
                <button
                  className="library-primary-button"
                  disabled={disabled}
                  onClick={() =>
                    void perform(async () => {
                      const s = await save();
                      const saved = await experienceApi(
                        '/' + id + '/confirm',
                        'POST',
                        { expectedRevision: s.revision },
                      );
                      navigate('/library/' + saved.entryId);
                    })
                  }
                >
                  确认保存经历
                </button>
              </div>
            </section>
          )}
        </div>
        <button
          className="library-danger-button experience-discard"
          disabled={disabled}
          onClick={() => {
            if (
              !window.confirm(
                session.entryId
                  ? '将这条经历移入已归档？'
                  : '永久删除这条未完成复盘和照片？',
              )
            )
              return;
            void perform(async () => {
              await experienceApi('/' + id + '/lifecycle', 'POST', {
                expectedRevision: session.revision,
                action: session.entryId ? 'archive' : 'purge',
                confirm: true,
              });
              if (editorKey) updateComposerDraft(editorKey, { text: '' });
              navigate('/library/experience');
            });
          }}
        >
          {session.entryId ? '归档经历' : '删除未完成复盘'}
        </button>
      </div>
    </div>
  );
}
function DraftEditor({
  draft,
  onChange,
  disabled,
}: {
  draft: ExperienceDraft;
  onChange: (d: ExperienceDraft) => void;
  disabled: boolean;
}) {
  const meta = draft.experience,
    update = (patch: Partial<typeof meta>) =>
      onChange({ ...draft, experience: { ...meta, ...patch } }),
    split = (v: string) =>
      v
        .split(/[,，\n]/)
        .map((v) => v.trim())
        .filter(Boolean);
  return (
    <fieldset disabled={disabled}>
      <label>
        标题
        <input
          value={draft.title}
          maxLength={240}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </label>
      <label>
        摘要
        <textarea
          value={draft.summary}
          maxLength={1000}
          onChange={(e) => onChange({ ...draft, summary: e.target.value })}
        />
      </label>
      <label>
        正文
        <textarea
          className="experience-content-editor"
          value={draft.content}
          maxLength={100000}
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
        />
      </label>
      <label>
        标签（逗号分隔）
        <input
          value={draft.tags.join('，')}
          onChange={(e) => onChange({ ...draft, tags: split(e.target.value) })}
        />
      </label>
      <details>
        <summary>回忆信息 · 按需修改</summary>
        <label>
          经历类型
          <select
            value={meta.subtype}
            onChange={(e) =>
              update({ subtype: e.target.value as typeof meta.subtype })
            }
          >
            <option value="travel">旅行</option>
            <option value="other">其他经历</option>
          </select>
        </label>
        <label>
          时间（可以模糊）
          <input
            value={meta.time.description}
            onChange={(e) => update({ time: { description: e.target.value } })}
          />
        </label>
        <label>
          地点（逗号分隔）
          <input
            value={meta.places.join('，')}
            onChange={(e) => update({ places: split(e.target.value) })}
          />
        </label>
        <label>
          总体感受
          <textarea
            value={meta.impression}
            onChange={(e) => update({ impression: e.target.value })}
          />
        </label>
        <label>
          愿意再去 / 再做
          <select
            value={meta.repeatIntent}
            onChange={(e) =>
              update({
                repeatIntent: e.target.value as typeof meta.repeatIntent,
              })
            }
          >
            <option value="unknown">还没决定</option>
            <option value="yes">愿意</option>
            <option value="no">不愿意</option>
            <option value="conditional">有条件愿意</option>
          </select>
        </label>
        <label>
          适合谁 / 不适合谁
          <textarea
            value={meta.audienceNotes.join('\n')}
            onChange={(e) =>
              update({ audienceNotes: e.target.value.split('\n') })
            }
          />
        </label>
        <label>
          下次提醒自己的话
          <textarea
            value={meta.lessons.join('\n')}
            onChange={(e) => update({ lessons: e.target.value.split('\n') })}
          />
        </label>
        {meta.rating && (
          <p>
            我的评分：{meta.rating.description || meta.rating.value}
            <button
              type="button"
              className="library-inline-button"
              onClick={() => {
                const next = { ...meta };
                delete next.rating;
                onChange({ ...draft, experience: next });
              }}
            >
              移除评分
            </button>
          </p>
        )}
      </details>
    </fieldset>
  );
}
