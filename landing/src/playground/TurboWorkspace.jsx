import { TURBO, TurboWindow, turboOutputTokens, turboTokens } from '../components/turbo.jsx';
import { FileList, PackageList, plainButton } from './ProjectPanel.jsx';
import { ConsoleLines, runInfo } from './parts.jsx';
import { OpenFile, ViewSwitch, shortName } from './workspace.jsx';

// The Turbo look: Turbo C++'s windows on its blue desktop, the project and its packages beside the editor and the
// output below. Only the colours, frames and font differ; the parts are the modern look's. Inside it the site's
// light and dark do not apply.

function AddButton({ tokens, onClick, disabled, children }) {
    return (
        <button type="button" onClick={onClick} disabled={disabled} className="tap-target" style={{ ...plainButton, padding: '0 8px', color: tokens.textMuted, fontFamily: tokens.mono }}>
            {children}
        </button>
    );
}

export default function TurboWorkspace({
    tokens, project, sampleId, shown, view, busy, creating, lines, buildLog, lastRun, intro,
    onView, onOpen, onCreating, onCreateFile, onRemoveFile, onAddPackage, onRemovePackage, onEdit,
}) {
    const turbo = turboTokens(tokens);
    const output = turboOutputTokens(tokens);
    const content = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 4px 6px' };
    const viewButton = (selected) => ({
        flex: 1, padding: '2px 8px', fontFamily: tokens.mono, fontSize: 13, cursor: 'pointer', border: 'none', color: TURBO.black, background: selected ? TURBO.green : 'transparent',
    });

    return (
        <>
            <ViewSwitch view={view} onView={onView} buttonStyle={viewButton} style={{ background: TURBO.gray, padding: '2px 4px', borderTop: `1px solid ${TURBO.black}` }} />
            <div className="turbo-body" style={{ background: TURBO.blue, color: TURBO.yellow, fontFamily: tokens.mono, fontSize: 13, lineHeight: '20px' }}>
                <TurboWindow title="Project" className="playground-pane turbo-project" data-shown={view === 'files'}>
                    <div style={content}>
                        <FileList
                            tokens={turbo}
                            project={project}
                            active={shown}
                            disabled={busy}
                            creating={creating}
                            onCreating={onCreating}
                            onOpen={onOpen}
                            onCreateFile={onCreateFile}
                            onRemoveFile={onRemoveFile}
                        />
                        <AddButton tokens={turbo} onClick={() => onCreating(true)} disabled={busy}>[+] New file</AddButton>
                    </div>
                </TurboWindow>
                <TurboWindow title="Packages" className="playground-pane turbo-packages" data-shown={view === 'files'}>
                    <div style={content}>
                        <PackageList tokens={turbo} project={project} disabled={busy} onRemovePackage={onRemovePackage} />
                        <AddButton tokens={turbo} onClick={onAddPackage} disabled={busy}>[+] Add package</AddButton>
                    </div>
                </TurboWindow>
                <TurboWindow title={shortName(shown)} number="1" label={`Editor, ${shown}`} className="playground-pane turbo-editor" data-shown={view === 'code'}>
                    <div style={{ flex: 1, minHeight: 0, paddingTop: 8 }}>
                        <OpenFile tokens={turbo} project={project} sampleId={sampleId} shown={shown} onEdit={onEdit} />
                    </div>
                </TurboWindow>
                <TurboWindow title="Output" number={runInfo(lastRun) || null} background={TURBO.black} className="playground-pane turbo-output" data-shown={view === 'console'}>
                    <div style={{ ...content, padding: '10px 14px' }}>
                        <ConsoleLines tokens={output} lines={lines} buildLog={buildLog} intro={intro} />
                    </div>
                </TurboWindow>
            </div>
        </>
    );
}
