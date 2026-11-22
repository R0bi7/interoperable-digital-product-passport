// LaTeX (booktabs) output for the evaluation tables, so the thesis can \input them instead of retyping numbers.
// Needs \usepackage{booktabs}.

const SPECIAL: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '&': '\\&',
    '%': '\\%',
    $: '\\$',
    '#': '\\#',
    _: '\\_',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
}

export const escapeLatex = (text: string): string => text.replace(/[\\&%$#_{}~^]/g, (c) => SPECIAL[c])

/** `alignment` is one letter per column (l, r, c). The first row is the header. */
export function latexTable(alignment: string, rows: readonly (readonly string[])[], caption?: string, label?: string) {
    if (rows.length === 0) throw new Error('latexTable needs at least a header row')
    const line = (row: readonly string[]) => `    ${row.map(escapeLatex).join(' & ')} \\\\`
    return [
        '\\begin{table}[htbp]',
        '    \\centering',
        '    \\small',
        `    \\begin{tabular}{${alignment}}`,
        '    \\toprule',
        line(rows[0]),
        '    \\midrule',
        ...rows.slice(1).map(line),
        '    \\bottomrule',
        '    \\end{tabular}',
        ...(caption ? [`    \\caption{${escapeLatex(caption)}}`] : []),
        ...(label ? [`    \\label{${label}}`] : []),
        '\\end{table}',
        '',
    ].join('\n')
}
