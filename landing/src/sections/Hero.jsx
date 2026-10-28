import { useState } from 'react';
import CommandChip from '../components/CommandChip.jsx';
import PlatformScene from '../components/PlatformScene.jsx';
import PromptModal from '../components/PromptModal.jsx';
import Tabs from '../components/Tabs.jsx';
import { TURBO, TURBO_SYNTAX, TitlePart } from '../components/turbo.jsx';
import { highlight, primaryButtonStyle, secondaryButtonStyle } from '../components/ui.jsx';
import {
    CREATE_COMMANDS, HERO_CONFIG, PLAYGROUND_URL, RUNTIMES,
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
// sample's own C++ and Rust and one package of each source (a crossbind port, a crate, a Conan
// package), and each call is awaited because browsers run the module in a worker by default.
const HERO_FILES = Object.freeze([
    { id: 'main.js', label: 'main.js', code: heroMain.trimEnd() },
    { id: 'greet.h', label: 'greet.h', code: heroGreet.trimEnd() },
    { id: 'math.rs', label: 'math.rs', code: heroMath.trimEnd() },
    { id: 'crossbind.config.js', label: 'crossbind.config.js', code: HERO_CONFIG },
]);
const HERO_RUN = `${PLAYGROUND_URL}?sample=hero&skin=turbo`;

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
                <a href={HERO_RUN} aria-label="Run in the playground" className="tap-target" style={{ marginLeft: 'auto', padding: '0 8px', color: '#000', textDecoration: 'none' }}>
                    <span style={{ color: TURBO.red }}>R</span>
                    un
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
                        Import C++ and Rust
                        <br />
                        <span style={{ color: tokens.accentDisplay }}>like JavaScript modules.</span>
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
                </div>
            </div>

            <RunsOn tokens={tokens} />

            <PromptModal tokens={tokens} open={promptOpen} onClose={() => setPromptOpen(false)} />
        </section>
    );
}
