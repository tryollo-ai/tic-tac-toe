import type { Metadata } from "next";
import "./globals.scss";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Trick-Tac-Toe",
  description: "Play trick-tac-toe against a friend or an unbeatable AI.",
};

type Props = {
  children: React.ReactNode;
};

const RootLayout = (props: Props) => {
  return (
    <html lang="en">
      <body>
        <Providers>{props.children}</Providers>
      </body>
    </html>
  );
};

export default RootLayout;
