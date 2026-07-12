import { defaultSchema } from "rehype-sanitize";

/**
 * @uiw/react-markdown-preview は rehype-raw を無条件に含み生 HTML を描画するため、
 * rehype-sanitize で従来（react-markdown: 生 HTML 非描画）の安全水準を維持する。
 * ただし既定 schema のままではコードハイライト（rehype-prism-plus）が付与する
 * className や GFM タスクリストの checkbox まで剥がれるため、無害な範囲で許可を広げる。
 */
export const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-./],
    ],
    span: [...(defaultSchema.attributes?.span ?? []), ["className"]],
    // GFM タスクリスト（<input type="checkbox" disabled checked>）
    input: [
      ...(defaultSchema.attributes?.input ?? []),
      ["type", "checkbox"],
      ["disabled", true],
      ["checked", true],
    ],
    li: [...(defaultSchema.attributes?.li ?? []), ["className"]],
    ul: [...(defaultSchema.attributes?.ul ?? []), ["className"]],
  },
} as typeof defaultSchema;
