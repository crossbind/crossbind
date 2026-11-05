package dev.crossbind.e2e.probe;

// The same files from a provider no other app may read, which e2e/run.mjs opens the app on as well: the app takes none of
// them, as it would read them for whichever app opened it.
public final class ProbePrivateFiles extends ProbeFiles {
}
