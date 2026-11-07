import { useState } from 'react';
import CommandChip from '../components/CommandChip.jsx';
import PlatformScene from '../components/PlatformScene.jsx';
import PromptModal from '../components/PromptModal.jsx';
import Tabs from '../components/Tabs.jsx';
import {
    TURBO, TURBO_SYNTAX, TitlePart, TurboWindow,
} from '../components/turbo.jsx';
import { highlight, primaryButtonStyle, secondaryButtonStyle } from '../components/ui.jsx';
import {
    CREATE_COMMANDS, HERO_TERMINAL, PLAYGROUND_URL, RUNTIMES,
} from '../data.js';
import heroMain from '../playground/samples/hero/main.js?raw';
import heroGreet from '../playground/samples/hero/native/greet.h?raw';
import heroMath from '../playground/samples/hero/native/math.rs?raw';
import { guideHref } from '../guide/nav.js';

// The band under the hero; the detail of each target is its tooltip.
function RunsOn({ tokens }) {
    return (
        <ul className="runs-on-list" style={{ marginTop: 56 }}>
            {RUNTIMES.map((runtime) => (
                <li key={runtime.id} className="runs-on-item" title={runtime.detail}>
                    <span style={{ display: 'flex', color: tokens.textMuted, marginBottom: 8 }}>
                        <PlatformScene id={runtime.scene} />
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: tokens.text }}>{runtime.title}</span>
                    <span style={{ maxWidth: 190, fontSize: 13, color: tokens.textMuted, textAlign: 'center', textWrap: 'balance' }}>
                        {runtime.names}
                        {runtime.via && (
                            <>
                                <br />
                                {runtime.via}
                            </>
                        )}
                    </span>
                </li>
            ))}
        </ul>
    );
}

function CreateCommand({ tokens }) {
    const [active, setActive] = useState(CREATE_COMMANDS[0].id);
    const { command } = CREATE_COMMANDS.find((entry) => entry.id === active);

    return (
        <>
            <Tabs tokens={tokens} label="Package manager" tabs={CREATE_COMMANDS} panelId="create-panel" active={active} onSelect={setActive} />
            <div role="tabpanel" id="create-panel" aria-labelledby={`create-panel-${active}`} style={{ maxWidth: 560 }}>
                <CommandChip tokens={tokens} command={command} />
            </div>
        </>
    );
}

// The playground's hero sample, which Run opens in the playground's Turbo look: main.js imports the
// sample's own C++ and Rust, and each call is awaited because browsers run the module in a worker by
// default.
const HERO_FILES = Object.freeze([
    { id: 'main.js', label: 'main.js', code: heroMain.trimEnd() },
    { id: 'greet.h', label: 'greet.h', code: heroGreet.trimEnd() },
    { id: 'math.rs', label: 'math.rs', code: heroMath.trimEnd() },
]);
const HERO_RUN = `${PLAYGROUND_URL}?sample=hero`;
// The brightest red that reads on the menu's gray, at 4.5:1; Turbo's own #aa0000 gives 3.3:1.
const TRY_RED = '#850000';

// The headline claims C++ and Rust, so the proof sits right beside it: main.js imports both, shown
// in Turbo C++, the IDE a generation first wrote C++ in: the files are its menu, the code is in its
// editor window. Every file stays in one grid cell, so switching keeps the window's height.
function UniversalCode({ tokens }) {
    const [active, setActive] = useState(HERO_FILES[0].id);
    const syntax = { ...tokens, ...TURBO_SYNTAX };

    return (
        <div style={{
            borderRadius: 4,
            overflow: 'hidden',
            background: TURBO.blue,
            color: TURBO.yellow,
            fontFamily: tokens.mono,
            fontSize: 13,
            lineHeight: '20px',
        }}
        >
            <div className="turbo-menu" style={{ display: 'flex', alignItems: 'flex-start', padding: '0 4px', background: TURBO.gray, color: '#000', '--hover': TURBO.white }}>
                {/* Sized like a tab, so it stays on the first row when the menu wraps on a phone. */}
                <span aria-hidden="true" className="tap-target" style={{ padding: '0 8px' }}>≡</span>
                <Tabs
                    tokens={tokens}
                    label="Files"
                    tabs={HERO_FILES}
                    panelId="hero-file"
                    active={active}
                    onSelect={setActive}
                    style={{ flexWrap: 'wrap', gap: 0, marginBottom: 0 }}
                    tabStyle={(selected) => ({
                        // Unset unless selected: .turbo-menu in styles.css owns it, so a hover can light it.
                        background: selected ? TURBO.green : undefined,
                        border: 'none',
                        borderRadius: 0,
                        color: '#000',
                        padding: '0 8px',
                        fontSize: 13,
                    })}
                />
                <a href={HERO_RUN} aria-label="Try in Playground" className="tap-target" style={{ marginLeft: 'auto', padding: '0 8px', color: TRY_RED, fontWeight: 700, textDecoration: 'none' }}>
                    {/* One inline run, so the flex link keeps the space before "in". */}
                    <span>
                        Try
                        <span className="hero-try-rest">{' in Playground'}</span>
                    </span>
                </a>
            </div>
            <div style={{ padding: '14px 6px 6px' }}>
                <div style={{ position: 'relative', border: `3px double ${TURBO.white}` }}>
                    <TitlePart style={{ left: 8 }}>[<span style={{ color: TURBO.lime }}>■</span>]</TitlePart>
                    <TitlePart style={{ left: '50%', transform: 'translateX(-50%)' }}>{active}</TitlePart>
                    <TitlePart style={{ right: 8 }}>1</TitlePart>
                    <div
                        role="tabpanel"
                        id="hero-file"
                        aria-labelledby={`hero-file-${active}`}
                        style={{ display: 'grid', overflowX: 'auto', padding: '10px 14px', whiteSpace: 'pre' }}
                    >
                        {HERO_FILES.map((file) => (
                            <div key={file.id} style={{ gridArea: '1 / 1', visibility: file.id === active ? 'visible' : 'hidden' }}>
                                {highlight(file.code, syntax)}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

// The app commands, in a window of their own: the code window's Run runs main.js in the playground, and these are typed
// in a terminal, so the two stay apart.
function AppTerminal({ tokens }) {
    return (
        <div style={{
            marginTop: 16, padding: '14px 6px 6px', borderRadius: 4, background: TURBO.black, fontFamily: tokens.mono, fontSize: 13, lineHeight: '20px',
        }}
        >
            <TurboWindow title="Terminal" background={TURBO.black} style={{ padding: '10px 14px', color: TURBO.white, whiteSpace: 'pre' }}>
                {HERO_TERMINAL.map(({ comment, command }, index) => (
                    <div key={command} style={{ marginTop: index ? 20 : 0 }}>
                        <div style={{ color: TURBO.gray }}>{`# ${comment}`}</div>
                        <div>
                            <span aria-hidden="true" style={{ color: TURBO.gray }}>$ </span>
                            {command}
                        </div>
                    </div>
                ))}
            </TurboWindow>
        </div>
    );
}

// The docs path is the primary call; the agent prompt stays one click away as the secondary.
function AgentSetup({ tokens, onOpen }) {
    return (
        <button
            type="button"
            className="tap-target"
            onClick={onOpen}
            aria-haspopup="dialog"
            style={{ ...secondaryButtonStyle(tokens), cursor: 'pointer' }}
        >
            Agent setup
        </button>
    );
}

export default function Hero({ tokens }) {
    const [promptOpen, setPromptOpen] = useState(false);

    return (
        <section className="hero" style={{ padding: '56px var(--content-x) 48px' }}>
            <div className="hero-grid">
                <div>
                    <h1 style={{
                        fontFamily: tokens.sans,
                        fontSize: 'var(--hero-title)',
                        fontWeight: 600,
                        lineHeight: 1.04,
                        letterSpacing: '-0.04em',
                        margin: '0 0 64px',
                    }}
                    >
                        Build and ship JS&nbsp;apps.
                        <br />
                        <span style={{ color: tokens.accentDisplay }}>Add C++ and Rust as&nbsp;needed.</span>
                    </h1>

                    <CreateCommand tokens={tokens} />

                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '52px 0 18px' }}>
                        <a className="tap-target" href={guideHref('quick-start')} style={primaryButtonStyle(tokens)}>
                            Get started
                        </a>
                        <AgentSetup tokens={tokens} onOpen={() => setPromptOpen(true)} />
                    </div>

                    <p style={{ margin: 0, fontSize: 13.5, color: tokens.textMuted }}>
                        Free and open source under the MIT license.
                    </p>
                </div>

                <div style={{ minWidth: 0 }}>
                    <UniversalCode tokens={tokens} />
                    <AppTerminal tokens={tokens} />
                </div>
            </div>

            <RunsOn tokens={tokens} />

            <PromptModal tokens={tokens} open={promptOpen} onClose={() => setPromptOpen(false)} />
        </section>
    );
}
