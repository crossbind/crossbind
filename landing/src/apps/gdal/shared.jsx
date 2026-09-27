import { REPO_URL } from '../../data.js';
import { Label } from '../AppCard.jsx';
import { grouped } from '../controls.jsx';

const DIRECTORY = '/memfs/gdalapps';

export const size = (bytes) => {
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`;
    if (bytes >= 1e4) return `${(bytes / 1000).toFixed(1)} KB`;
    return `${grouped(bytes)} B`;
};
const failed = (error) => (error?.message ?? String(error)).replace(/^std::[\w:]+: /, '').trim();
// Native exceptions arrive as "std::runtime_error: <what>"; the card shows only the what.
export const plainly = (work) => async (m) => {
    try {
        return await work(m);
    } catch (error) {
        throw new Error(failed(error));
    }
};

// A folder of its own for every call that writes: m.FS.writeFile appends to an existing file, and
// GDAL refuses to create a dataset over one.
let folders = 0;
export async function freshFolder(m, name) {
    folders += 1;
    const folder = `${DIRECTORY}/${name}-${folders}`;
    await m.FS.mkdirTree(folder);
    return folder;
}

export function Segmented({ tokens, label, value, options, onChange, disabled }) {
    return (
        <div role="group" aria-label={label} style={{ minWidth: 0 }}>
            <Label tokens={tokens}>{label.toUpperCase()}</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {options.map(([id, text]) => (
                    <button
                        key={id}
                        type="button"
                        className="tap-target"
                        aria-pressed={value === id}
                        disabled={disabled}
                        onClick={() => onChange(id)}
                        style={{
                            padding: '7px 11px',
                            borderRadius: 8,
                            fontSize: 13,
                            cursor: disabled ? 'progress' : 'pointer',
                            background: value === id ? tokens.pillBg : 'transparent',
                            color: value === id ? tokens.text : tokens.textDim,
                            border: `1px solid ${value === id ? tokens.accent : tokens.border}`,
                        }}
                    >
                        {text}
                    </button>
                ))}
            </div>
        </div>
    );
}

// Serving this module conveys GEOS and libiconv, which it links statically, so every app links their sources.
export function LicenceNote({ tokens }) {
    const external = { target: '_blank', rel: 'noreferrer', style: { color: tokens.accentText, textDecoration: 'underline', textUnderlineOffset: 3 } };
    return (
        <span>
            {'GDAL is MIT; this module also links GEOS and libiconv, which are LGPL: '}
            <a href="https://github.com/libgeos/geos" {...external}>GEOS source</a>
            {' · '}
            <a href="https://www.gnu.org/software/libiconv/" {...external}>libiconv source</a>
            {' · '}
            <a href={`${REPO_URL}/tree/main/ports/gdal`} {...external}>build recipe</a>
        </span>
    );
}
