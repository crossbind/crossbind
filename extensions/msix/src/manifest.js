import { xmlText } from './pack.js';

// Windows 10 1809, the first to run a Win32 app from its MSIX package without a converter.
const MIN_VERSION = '10.0.17763.0';
const MAX_VERSION_TESTED = '10.0.26100.0';

// The logos the manifest names, which the package carries at these sizes.
export const LOGOS = Object.freeze({
    store: { file: 'Assets/StoreLogo.png', size: 50 },
    square150: { file: 'Assets/Square150x150Logo.png', size: 150 },
    square44: { file: 'Assets/Square44x44Logo.png', size: 44 },
});
const manifestPath = (file) => file.replaceAll('/', '\\');

// An extension a Win32 app's URL scheme or file type opens it by: Windows starts its executable with the URL or the
// file's path, as the app's setup program registers them.
const OPEN_ARGUMENT = '&quot;%1&quot;';
const protocolXml = (scheme) =>
    `<uap3:Extension Category="windows.protocol"><uap3:Protocol Name="${xmlText(scheme)}" Parameters="${OPEN_ARGUMENT}"/></uap3:Extension>`;
const fileTypeXml = ({ name, extensions, mimeTypes }) =>
    [
        `<uap3:Extension Category="windows.fileTypeAssociation"><uap3:FileTypeAssociation Name="${extensions[0]}" Parameters="${OPEN_ARGUMENT}">`,
        `<uap:DisplayName>${xmlText(name)}</uap:DisplayName><uap:SupportedFileTypes>`,
        ...extensions.map((ending) => `<uap:FileType${mimeTypes[0] ? ` ContentType="${xmlText(mimeTypes[0])}"` : ''}>.${ending}</uap:FileType>`),
        '</uap:SupportedFileTypes></uap3:FileTypeAssociation></uap3:Extension>',
    ].join('');
const aliasXml = (alias) =>
    `<uap3:Extension Category="windows.appExecutionAlias"><uap3:AppExecutionAlias><desktop:ExecutionAlias Alias="${xmlText(alias)}"/></uap3:AppExecutionAlias></uap3:Extension>`;

// The AppxManifest.xml of a Win32 app in an MSIX package: its identity, which the Store gives an app it publishes,
// its names and logos, the executable Windows starts with full trust, and what opens it.
export function appxManifest({
    identity,
    displayName,
    publisherDisplayName,
    description,
    executable,
    urlSchemes = [],
    fileTypes = [],
    alias = null,
}) {
    const extensions = [...urlSchemes.map(protocolXml), ...fileTypes.map(fileTypeXml), ...(alias ? [aliasXml(alias)] : [])];
    return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3" xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap uap3 desktop rescap">
  <Identity Name="${xmlText(identity.name)}" Publisher="${xmlText(identity.publisher)}" Version="${identity.version}" ProcessorArchitecture="${identity.arch}"/>
  <Properties>
    <DisplayName>${xmlText(displayName)}</DisplayName>
    <PublisherDisplayName>${xmlText(publisherDisplayName)}</PublisherDisplayName>
    <Logo>${manifestPath(LOGOS.store.file)}</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="${MIN_VERSION}" MaxVersionTested="${MAX_VERSION_TESTED}"/>
  </Dependencies>
  <Resources>
    <Resource Language="en-us"/>
  </Resources>
  <Applications>
    <Application Id="App" Executable="${xmlText(executable)}" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="${xmlText(displayName)}" Description="${xmlText(description)}" BackgroundColor="transparent" Square150x150Logo="${manifestPath(LOGOS.square150.file)}" Square44x44Logo="${manifestPath(LOGOS.square44.file)}"/>${
          extensions.length > 0
              ? `
      <Extensions>${extensions.join('')}</Extensions>`
              : ''
      }
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust"/>
  </Capabilities>
</Package>
`;
}
