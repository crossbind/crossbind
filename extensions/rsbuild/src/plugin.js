import webpackPlugin from '@crossbind/extension-webpack/plugin';

const NAME = 'crossbind';

// crossbind's Rsbuild plugin, on the api crossbind() hands it. Rsbuild builds with Rspack, on which crossbind's webpack
// plugin builds the page; Rsbuild's own server takes what webpack-dev-server would: in front, the middleware that links
// and serves the glue the boot code asks for, the headers of an isolated page, and a reload after a native source
// changes, which is no module.
export default function rsbuildPlugin(api) {
    return {
        name: NAME,
        // Rsbuild asks first whether the plugin is for the build, the dev server or the preview: it is for each.
        apply: () => true,
        setup(rsbuild) {
            // A web environment's: crossbind's module of a header is the page's.
            rsbuild.modifyRspackConfig((config, { appendPlugins, target }) => {
                if (target === 'web') appendPlugins(webpackPlugin(api));
            });
            rsbuild.modifyRsbuildConfig(async (config, { mergeRsbuildConfig }) => {
                await api.ready();
                let serve = null;
                const glue = (req, res, next) => {
                    serve ??= api.serve(api.targets.debug, { isolate: true });
                    serve(req, res, next);
                };
                return mergeRsbuildConfig(config, {
                    server: {
                        headers: api.isolationHeaders,
                        setup: ({ action, server }) => {
                            if (action === 'dev') server.middlewares.use(glue);
                        },
                    },
                    dev: { watchFiles: { paths: api.nativeDirs(), type: 'reload-page' } },
                });
            });
        },
    };
}
