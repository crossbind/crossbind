# create-crossbind
**Create crossbind Applications**  

<a href="https://www.npmjs.com/package/create-crossbind">
    <img alt="NPM version" src="https://img.shields.io/npm/v/create-crossbind?style=for-the-badge" />
</a>
<a href="https://github.com/crossbind/crossbind/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/crossbind/crossbind?style=for-the-badge" />
</a>
<a href="https://crossbind.dev/docs/guide/getting-started/create-a-project">
    <img alt="Docs - Create App" src="https://img.shields.io/badge/Docs_-_Create_App-20B2AA?style=for-the-badge" />
</a>

# Getting Started

>**Note**: Make sure you have completed the [crossbind - Prerequisites](https://crossbind.dev/docs/guide/getting-started/prerequisites) instructions.

```bash
npm create crossbind@beta
```

This command will install and execute create-crossbind, the official crossbind project scaffolding tool. You will be presented with prompts for several optional features such as React.

```
Welcome to crossbind!

✔ Project Name … <your-project-name>
✔ Where should we create your project?
  (leave blank to use current directory) … <your-project-name>
✔ Select a type: › Web
✔ Select a framework: › React
✔ Select a bundler: › Vite

Your project is ready!
```

If you are unsure about an option, simply choose Web, React and Vite. Once the project is created, follow the instructions to install dependencies and start the dev server:

```bash
cd <your-project-name>
npm install
npm run dev
```

You should now have your first crossbind project running!

## Without the prompts

Every prompt can be preselected positionally, which is what CI and scripted setups use.
`npm create crossbind@beta -- --help` prints the list of templates.

```bash
npm create crossbind@beta -- my-app Web React Vite
npm create crossbind@beta -- my-app Desktop Electron
npm create crossbind@beta -- my-tool Native Executable
npm create crossbind@beta -- my-lib Library Prebuilt
```

When you are ready to ship your app to production, run the following:

```bash
npm run build
```

This will create a production-ready build of your app in the project's ./dist directory.
