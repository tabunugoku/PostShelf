import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/Icon';
import { COLORS, ICONS, displayName, type Folder } from '../shared/models';
import { t } from '../shared/strings';
import { updateFolder } from '../shared/storage';

/**
 * フォルダの編集ポップオーバーの中身 (名前 / アイコン / 色 (色なし含む))。
 * アイコンと色は選んだ時点で保存し、名前は Enter / フォーカスを外したときに保存する。
 */
export function FolderEdit(props: { folder: Folder; onSaved: () => void; onRequestDelete: () => void }) {
  const { folder } = props;
  const [name, setName] = useState(displayName(folder));
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const apply = async (patch: Parameters<typeof updateFolder>[1]) => {
    try {
      await updateFolder(folder.id, patch);
      setError('');
      props.onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const commitName = () => {
    if (name !== displayName(folder)) void apply({ name });
  };

  return (
    <div class="folder-edit">
      <div class="erow">
        <span class="elabel">{t('name')}</span>
        <input
          ref={input}
          class="grow"
          value={name}
          aria-label={t('name')}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitName();
            }
          }}
        />
      </div>
      <div class="erow wrap">
        <span class="elabel">{t('icon')}</span>
        {ICONS.slice(0, 8).map((i) => (
          <button class={`ic${i === folder.icon ? ' on' : ''}`} aria-label={i} aria-pressed={i === folder.icon} onClick={() => void apply({ icon: i })}>
            <Icon name={i} />
          </button>
        ))}
      </div>
      <div class="erow wrap">
        <span class="elabel">{t('color')}</span>
        <button
          class={`sw sw-none${folder.color === undefined ? ' on' : ''}`}
          aria-label={t('colorNone')}
          title={t('colorNone')}
          aria-pressed={folder.color === undefined}
          onClick={() => void apply({ color: null })}
        />
        {COLORS.map((c) => (
          <button
            class={`sw${c === folder.color ? ' on' : ''}`}
            style={{ background: c }}
            aria-label={c}
            aria-pressed={c === folder.color}
            onClick={() => void apply({ color: c })}
          />
        ))}
      </div>
      {error && <p class="error">{error}</p>}
      <div class="erow">
        <button class="danger" onClick={props.onRequestDelete}>
          <Icon name="ti-trash" /> {t('delete')}
        </button>
      </div>
    </div>
  );
}

