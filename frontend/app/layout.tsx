import type { Metadata } from "next";
import "./globals.css";
import "./feature.css";
import "./workspace-ui.css";

export const metadata: Metadata = {
  title: "政企拜访助手",
  description: "客户摸底、需求拆解、能力匹配和拜访话术一站式工作台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
