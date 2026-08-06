import { redirect } from "next/navigation";

/**
 * ADR-0010: 学び登録フォームは廃止。MCP / じゅもん経路へ誘導。
 * 旧ブックマーク救済のためリダイレクトのみ残す。
 */
export default function NewEntryPage() {
  redirect("/entries?hint=mcp");
}
