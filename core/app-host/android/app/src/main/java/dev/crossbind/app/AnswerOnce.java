package dev.crossbind.app;

import java.util.concurrent.atomic.AtomicInteger;

// Whether a request of the page's has its answer: the first is the one, and useDefault() as its owner's hook runs
// leaves it to the WebView, which takes it from there; one left after the hook is answered as without an owner.
final class AnswerOnce {
    private static final int ASKING = 0;
    private static final int OPEN = 1;
    private static final int GIVEN = 2;
    private static final int LEFT = 3;

    private final AtomicInteger phase = new AtomicInteger(ASKING);

    // Whether this is the answer, as none came before it.
    boolean gives() {
        return phase.compareAndSet(ASKING, GIVEN) || phase.compareAndSet(OPEN, GIVEN);
    }

    // Whether the WebView takes the request, as its owner's hook runs.
    boolean leaves() {
        return phase.compareAndSet(ASKING, LEFT);
    }

    // As the hook returns: whether its owner left the request to the WebView.
    boolean isLeft() {
        phase.compareAndSet(ASKING, OPEN);
        return phase.get() == LEFT;
    }
}
