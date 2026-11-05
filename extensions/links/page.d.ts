/** What the event open-url carries: a link of one of app.urlSchemes, or on iOS and Android of app.links, that the system opened the app with. */
export interface OpenUrl {
    url: string;
}

export declare const app: {
    /** The links of app.urlSchemes in crossbind.config.js that opened the app and have not reached the page yet, the one it was launched with among them. Once the page has asked, each later link comes as the event open-url while it listens, so listening first, then asking, misses none. */
    launchUrls(): Promise<string[]>;
};

declare module 'crossbind/app/core' {
    interface AppEvents {
        /** Calls listener with each link of app.urlSchemes the system opens the app with once the page has called app.launchUrls(), or events.held('open-url'), until the function it returns is called. */
        'open-url': OpenUrl;
    }
    interface HeldEvents {
        /** The links of app.urlSchemes the host held for the page, which came before it asked since it loaded, as app.launchUrls() gives their addresses. */
        'open-url': OpenUrl;
    }
}
