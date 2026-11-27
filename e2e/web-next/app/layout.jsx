export const metadata = { title: 'crossbind Next.js Playground' };

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
