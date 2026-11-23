import { configSource } from '../../../tooling/cloud/compiler/packages.js';
import Editor from '../../../tooling/learn/src/Editor.jsx';
import { CONFIG } from './ProjectPanel.jsx';

// What the playground's two looks (ModernWorkspace.jsx, TurboWorkspace.jsx) share: the open file, and on narrow
// screens the switch between the files, the code and the console, of which one shows at a time (styles.css).

const VIEWS = Object.freeze([{ id: 'files', label: 'Files' }, { id: 'code', label: 'Code' }, { id: 'console', label: 'Console' }]);

export const shortName = (name) => name.replace(/^native\//, '');

export function ViewSwitch({
    view, onView, style, buttonStyle,
}) {
    return (
        <div className="playground-views" style={style}>
            {VIEWS.map(({ id, label }) => (
                <button key={id} type="button" aria-pressed={view === id} onClick={() => onView(id)} className="tap-target" style={buttonStyle(view === id)}>
                    {label}
                </button>
            ))}
        </div>
    );
}

// The config is the one the compiler writes from the packages, in the order it takes them (validate.js sorts them),
// so it shows read-only.
export function OpenFile({
    tokens, project, sampleId, shown, onEdit,
}) {
    if (shown === CONFIG) {
        return <Editor key={`${sampleId}/${CONFIG}`} tokens={tokens} label={`${CONFIG}, written from the packages`} value={configSource([...project.packages].sort())} onChange={() => {}} fill readOnly />;
    }
    return <Editor key={`${sampleId}/${shown}`} tokens={tokens} label={shown} value={project.files[shown]} onChange={onEdit} fill />;
}
