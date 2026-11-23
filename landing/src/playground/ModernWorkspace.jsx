import Tabs from '../components/Tabs.jsx';
import ProjectPanel, { CONFIG } from './ProjectPanel.jsx';
import { ConsoleLines, runInfo } from '../../../tooling/learn/src/output.jsx';
import { fileNames } from '../../../tooling/learn/src/project.js';
import {
    OpenFile, ViewSwitch, shortName,
} from './workspace.jsx';

// The modern look: the project beside the open file and the console, in the site's theme.
export default function ModernWorkspace({
    tokens, project, sampleId, shown, view, busy, creating, lines, buildLog, lastRun, intro,
    onView, onOpen, onSelectFile, onCreating, onCreateFile, onRemoveFile, onAddPackage, onRemovePackage, onEdit,
}) {
    const fileTabs = [...fileNames(project), CONFIG].map((name) => ({ id: name, label: shortName(name) }));
    const fileTab = (selected) => ({
        borderRadius: '8px 8px 0 0',
        border: `1px solid ${selected ? tokens.border : 'transparent'}`,
        borderBottom: 'none',
        background: selected ? tokens.codeBg : 'transparent',
        padding: '8px 14px',
        marginBottom: -1,
        whiteSpace: 'nowrap',
    });
    const viewButton = (selected) => ({
        flex: 1, padding: '6px 10px', fontSize: 13, borderRadius: 8, cursor: 'pointer', color: selected ? tokens.text : tokens.textDim, background: selected ? tokens.pillBg : 'transparent', border: `1px solid ${selected ? tokens.borderStrong : 'transparent'}`,
    });

    return (
        <>
            <ViewSwitch view={view} onView={onView} buttonStyle={viewButton} style={{ gap: 4, padding: '8px var(--playground-x)', borderBottom: `1px solid ${tokens.border}` }} />
            <div className="playground-body">
                <aside className="playground-pane" data-shown={view === 'files'} style={{ background: tokens.panelAlt, borderRight: `1px solid ${tokens.border}`, overflowY: 'auto' }}>
                    <ProjectPanel
                        tokens={tokens}
                        project={project}
                        active={shown}
                        disabled={busy}
                        creating={creating}
                        onCreating={onCreating}
                        onOpen={onOpen}
                        onCreateFile={onCreateFile}
                        onRemoveFile={onRemoveFile}
                        onAddPackage={onAddPackage}
                        onRemovePackage={onRemovePackage}
                    />
                </aside>
                <div className="playground-pane" data-shown={view === 'code'} style={{ background: tokens.codeBg }}>
                    <Tabs
                        tokens={tokens}
                        label="Open file"
                        tabs={fileTabs}
                        panelId="playground-file"
                        active={shown}
                        onSelect={onSelectFile}
                        tabStyle={fileTab}
                        style={{
                            margin: 0, gap: 2, padding: '6px 10px 0', overflowX: 'auto', background: tokens.codeSurface, borderBottom: `1px solid ${tokens.border}`,
                        }}
                    />
                    <div role="tabpanel" id="playground-file" aria-labelledby={`playground-file-${shown}`} style={{ flex: 1, minHeight: 0 }}>
                        <OpenFile tokens={tokens} project={project} sampleId={sampleId} shown={shown} onEdit={onEdit} />
                    </div>
                </div>
                <div className="playground-pane" data-shown={view === 'console'} style={{ background: tokens.panel, borderLeft: `1px solid ${tokens.border}` }}>
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 16px', fontSize: 12.5, color: tokens.textMuted, borderBottom: `1px solid ${tokens.border}`,
                    }}
                    >
                        <h2 style={{ margin: 0, font: 'inherit', fontWeight: 600, color: tokens.textDim }}>Console</h2>
                        <span>{runInfo(lastRun)}</span>
                    </div>
                    <div style={{
                        flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, fontFamily: tokens.mono, fontSize: 12.5, lineHeight: 1.8,
                    }}
                    >
                        <ConsoleLines tokens={tokens} lines={lines} buildLog={buildLog} intro={intro} />
                    </div>
                </div>
            </div>
        </>
    );
}
