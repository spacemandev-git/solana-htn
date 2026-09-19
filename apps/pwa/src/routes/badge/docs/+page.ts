import raw from '../../../../../../docs/HTNOS.md?raw';
import { marked, type Tokens } from 'marked';

export const prerender = true;

/** marked no longer emits heading ids; add GitHub-style slugs so `#3-examples` links work. */
function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/<[^>]+>/g, '')
		.replace(/[^a-z0-9\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-');
}

marked.use({
	renderer: {
		heading(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Heading) {
			const html = this.parser.parseInline(token.tokens);
			return `<h${token.depth} id="${slug(token.text)}">${html}</h${token.depth}>\n`;
		}
	}
});

export function load() {
	return { html: marked.parse(raw, { async: false }) as string, title: 'HTN OS docs' };
}
