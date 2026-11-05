export default function links() {
    return {
        name: 'links',
        contract: 1,
        root: import.meta.dirname,
        reads: ['urlSchemes', 'links'],
        // An app with schemes of its own, and a phone with https links of its own, which a desktop's system hands no app.
        fromApp(api) {
            const { urlSchemes, links } = api.config.app;
            return urlSchemes?.length > 0 || (['ios', 'android'].includes(api.platform) && links?.length > 0) ? {} : null;
        },
        app: {
            sources: ['native/links.cpp'],
        },
    };
}
