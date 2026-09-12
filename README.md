# cpp.js.org

The js.org subdomain cpp.js.org serves this branch through GitHub Pages. cpp.js became crossbind;
every page here is a stub that sends its path to https://crossbind.dev, whose `_redirects` maps the
old Docusaurus routes to the new pages. `404.html` does the same for paths that no longer exist,
and the cpp.js 1.x documentation is archived at https://v1.crossbind.dev.

The stubs were generated once from the page list of the previous deployment; nothing on the main
branch rebuilds them, and there is nothing to build.
