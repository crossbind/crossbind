// Header options the kit's headers need on every leg that bridges them: the prelude of the header
// that is not self-contained and the declaration the kit never defines. Spread into `export`.
export const conformanceExport = {
    headerPrelude: { 'confprelude.h': ['confpreludedeps.h'] },
    ignoredDeclarations: { 'conftypes.h': ['confTypeDeclaredOnly'] },
};
