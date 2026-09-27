export const title = 'An iconv command-line tool';
export const summary = 'WASI has no JavaScript bindings: the program is a main() that links the library, built into one .wasm and run with wasmtime. This one converts files the way the iconv command does, in 64 KB pieces, carrying a character cut between two pieces over to the next.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. .crossbind/build/iconv-tool-wasi-wasm32-st-release.wasm UTF-8 CP932 orders.csv orders-sjis.csv',
    'wasmtime run --dir=. .crossbind/build/iconv-tool-wasi-wasm32-st-release.wasm CP932 UTF-8 orders-sjis.csv orders-copy.csv',
];
export const expected = [
    'iconv 1.19 UTF-8 -> CP932: orders.csv -> orders-sjis.csv, 141371 B read, 110693 B written',
    'iconv 1.19 CP932 -> UTF-8: orders-sjis.csv -> orders-copy.csv, 110693 B read, 141371 B written',
];

// The file the commands work on: 4,000 orders in UTF-8, the export a web app would hand to a
// Japanese system that reads Windows Shift_JIS (CP932).
export function input() {
    const products = ['表計算ソフト', 'ノートPC', 'モニター 27型', 'キーボード', '無線マウス', 'USBケーブル'];
    const prefectures = ['東京都', '大阪府', '北海道', '福岡県', '愛知県'];
    const lines = ['注文番号,品名,数量,配送先'];
    for (let i = 0; i < 4000; i += 1) lines.push(`${100000 + i},${products[i % 6]},${1 + ((i * 7) % 9)},${prefectures[(i * 3) % 5]}`);
    return { 'orders.csv': `${lines.join('\n')}\n` };
}
