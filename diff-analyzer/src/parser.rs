//! Hand-rolled unified diff parser.
//!
//! `parse_file_diffs` turns unified diff text into a per-file list of hunks
//! (one `RawHunk` per `@@ ... @@` block), each carrying every line (context,
//! removed, added) tagged with its old/new line numbers.
//!
//! `analyze_diff` splits each `RawHunk` into minimal change runs: a maximal
//! run of consecutive `-`/`+` lines with no interleaved context line is one
//! output `Hunk`. Context lines break runs and are never part of a run
//! themselves, but they are used (together with the hunk's own `@@` trailing
//! hint) to find the nearest enclosing symbol.

use crate::hash::hunk_hash;
use crate::symbol::find_symbol;
use crate::types::Hunk;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    Context,
    Add,
    Remove,
}

#[derive(Debug, Clone)]
pub struct DiffLine {
    pub kind: LineKind,
    pub content: String,
    pub old_line_no: Option<usize>,
    pub new_line_no: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct RawHunk {
    pub old_start: usize,
    pub old_count: usize,
    pub new_start: usize,
    pub new_count: usize,
    /// Text after the second `@@` on the hunk header line (git's own
    /// best-effort enclosing-context hint), used as a symbol fallback.
    pub header_hint: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone)]
pub struct FileDiff {
    pub file: String,
    pub hunks: Vec<RawHunk>,
}

pub fn parse_file_diffs(diff_text: &str) -> Vec<FileDiff> {
    let lines: Vec<&str> = diff_text.lines().collect();
    let mut files: Vec<FileDiff> = Vec::new();
    let mut current_file: Option<String> = None;
    let mut old_file_path: Option<String> = None;

    let mut i = 0usize;
    while i < lines.len() {
        let line = lines[i];

        if line.starts_with("diff --git ") {
            current_file = None;
            old_file_path = None;
            i += 1;
            continue;
        }

        if let Some(rest) = line.strip_prefix("--- ") {
            old_file_path = strip_ab_prefix(rest.trim());
            i += 1;
            continue;
        }

        if let Some(rest) = line.strip_prefix("+++ ") {
            let new_path = strip_ab_prefix(rest.trim());
            current_file = new_path.or_else(|| old_file_path.clone());
            i += 1;
            continue;
        }

        if let Some((old_start, old_count, new_start, new_count, header_hint)) =
            parse_hunk_header(line)
        {
            let file_name = current_file.clone().unwrap_or_default();
            i += 1;
            let mut old_ln = old_start;
            let mut new_ln = new_start;
            let mut body: Vec<DiffLine> = Vec::new();

            while i < lines.len() {
                let l = lines[i];
                if l.starts_with("@@ ")
                    || l.starts_with("diff --git ")
                    || l.starts_with("--- ")
                {
                    break;
                }
                if l.starts_with('\\') {
                    // "\ No newline at end of file" - doesn't advance counters.
                    i += 1;
                    continue;
                }
                if let Some(rest) = l.strip_prefix(' ') {
                    body.push(DiffLine {
                        kind: LineKind::Context,
                        content: rest.to_string(),
                        old_line_no: Some(old_ln),
                        new_line_no: Some(new_ln),
                    });
                    old_ln += 1;
                    new_ln += 1;
                } else if let Some(rest) = l.strip_prefix('-') {
                    body.push(DiffLine {
                        kind: LineKind::Remove,
                        content: rest.to_string(),
                        old_line_no: Some(old_ln),
                        new_line_no: None,
                    });
                    old_ln += 1;
                } else if let Some(rest) = l.strip_prefix('+') {
                    body.push(DiffLine {
                        kind: LineKind::Add,
                        content: rest.to_string(),
                        old_line_no: None,
                        new_line_no: Some(new_ln),
                    });
                    new_ln += 1;
                } else if l.is_empty() {
                    // A genuinely blank line inside a hunk body always carries
                    // a leading context space in real unified diffs; an empty
                    // line here means we've run past the hunk (e.g. trailing
                    // blank at end of diff text).
                    break;
                } else {
                    // Unrecognized line (shouldn't happen for well-formed
                    // unified diffs) - stop this hunk's body defensively.
                    break;
                }
                i += 1;
            }

            get_or_create_file(&mut files, &file_name).hunks.push(RawHunk {
                old_start,
                old_count,
                new_start,
                new_count,
                header_hint,
                lines: body,
            });
            continue;
        }

        i += 1;
    }

    files
}

fn get_or_create_file<'a>(files: &'a mut Vec<FileDiff>, file_name: &str) -> &'a mut FileDiff {
    if let Some(idx) = files.iter().position(|f| f.file == file_name) {
        return &mut files[idx];
    }
    files.push(FileDiff {
        file: file_name.to_string(),
        hunks: Vec::new(),
    });
    files.last_mut().unwrap()
}

fn strip_ab_prefix(path: &str) -> Option<String> {
    if path == "/dev/null" {
        return None;
    }
    if let Some(rest) = path.strip_prefix("a/") {
        return Some(rest.to_string());
    }
    if let Some(rest) = path.strip_prefix("b/") {
        return Some(rest.to_string());
    }
    Some(path.to_string())
}

/// Parses a `@@ -old_start[,old_count] +new_start[,new_count] @@ <hint>` line.
fn parse_hunk_header(line: &str) -> Option<(usize, usize, usize, usize, String)> {
    let rest = line.strip_prefix("@@ ")?;
    let end_idx = rest.find(" @@")?;
    let ranges = &rest[..end_idx];
    let hint = rest[end_idx + 3..].trim().to_string();

    let mut parts = ranges.split_whitespace();
    let old_part = parts.next()?.strip_prefix('-')?;
    let new_part = parts.next()?.strip_prefix('+')?;
    let (old_start, old_count) = parse_range(old_part)?;
    let (new_start, new_count) = parse_range(new_part)?;
    Some((old_start, old_count, new_start, new_count, hint))
}

fn parse_range(s: &str) -> Option<(usize, usize)> {
    if let Some((start, count)) = s.split_once(',') {
        Some((start.parse().ok()?, count.parse().ok()?))
    } else {
        Some((s.parse().ok()?, 1))
    }
}

pub fn analyze_diff(diff_text: &str) -> Vec<Hunk> {
    let file_diffs = parse_file_diffs(diff_text);
    let mut hunks = Vec::new();

    for fd in &file_diffs {
        for raw in &fd.hunks {
            let mut run_start: Option<usize> = None;
            let mut idx = 0usize;
            while idx <= raw.lines.len() {
                let is_change = idx < raw.lines.len() && raw.lines[idx].kind != LineKind::Context;
                if is_change {
                    if run_start.is_none() {
                        run_start = Some(idx);
                    }
                    idx += 1;
                    continue;
                }
                if let Some(start) = run_start.take() {
                    let run = &raw.lines[start..idx];
                    let preceding = &raw.lines[..start];
                    hunks.push(build_hunk(&fd.file, preceding, raw, run));
                }
                idx += 1;
            }
        }
    }

    hunks
}

fn build_hunk(file: &str, preceding: &[DiffLine], raw: &RawHunk, run: &[DiffLine]) -> Hunk {
    let old_lines: Vec<String> = run
        .iter()
        .filter(|l| l.kind == LineKind::Remove)
        .map(|l| l.content.clone())
        .collect();
    let new_lines: Vec<String> = run
        .iter()
        .filter(|l| l.kind == LineKind::Add)
        .map(|l| l.content.clone())
        .collect();

    let old_nums: Vec<usize> = run
        .iter()
        .filter(|l| l.kind == LineKind::Remove)
        .filter_map(|l| l.old_line_no)
        .collect();
    let new_nums: Vec<usize> = run
        .iter()
        .filter(|l| l.kind == LineKind::Add)
        .filter_map(|l| l.new_line_no)
        .collect();

    let (old_start, old_end) = match (old_nums.first(), old_nums.last()) {
        (Some(&s), Some(&e)) => (s, e),
        _ => (0, 0),
    };
    let (new_start, new_end) = match (new_nums.first(), new_nums.last()) {
        (Some(&s), Some(&e)) => (s, e),
        _ => (0, 0),
    };

    let symbol = find_symbol(preceding, &raw.header_hint);
    let hash = hunk_hash(file, &old_lines, &new_lines);

    Hunk {
        file: file.to_string(),
        old_start,
        old_end,
        new_start,
        new_end,
        old_lines,
        new_lines,
        symbol,
        hunk_hash: hash,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SINGLE_LINE_MOD: &str = "diff --git a/services/payments/client.py b/services/payments/client.py\nindex c1f660d..ccc8363 100644\n--- a/services/payments/client.py\n+++ b/services/payments/client.py\n@@ -2,7 +2,7 @@\n \n import time\n \n-MAX_RETRIES = 3\n+MAX_RETRIES = 50\n BACKOFF_SECONDS = 2\n TIMEOUT_SECONDS = 10\n DEFAULT_CURRENCY = \"USD\"\n";

    #[test]
    fn single_line_modification_produces_one_hunk_with_ranges() {
        let hunks = analyze_diff(SINGLE_LINE_MOD);
        assert_eq!(hunks.len(), 1);
        let h = &hunks[0];
        assert_eq!(h.file, "services/payments/client.py");
        assert_eq!(h.old_lines, vec!["MAX_RETRIES = 3".to_string()]);
        assert_eq!(h.new_lines, vec!["MAX_RETRIES = 50".to_string()]);
        assert_eq!((h.old_start, h.old_end), (5, 5));
        assert_eq!((h.new_start, h.new_end), (5, 5));
        assert_eq!(h.hunk_hash.len(), 16);
    }

    #[test]
    fn symbol_empty_when_no_enclosing_def_or_class() {
        let hunks = analyze_diff(SINGLE_LINE_MOD);
        assert_eq!(hunks[0].symbol, "");
    }

    const PURE_ADDITION: &str = "diff --git a/foo.py b/foo.py\nindex 1111111..2222222 100644\n--- a/foo.py\n+++ b/foo.py\n@@ -1,2 +1,3 @@\n a = 1\n+b = 2\n c = 3\n";

    #[test]
    fn pure_addition_has_zero_old_range() {
        let hunks = analyze_diff(PURE_ADDITION);
        assert_eq!(hunks.len(), 1);
        let h = &hunks[0];
        assert_eq!((h.old_start, h.old_end), (0, 0));
        assert!(h.old_lines.is_empty());
        assert_eq!(h.new_lines, vec!["b = 2".to_string()]);
        assert_eq!((h.new_start, h.new_end), (2, 2));
    }

    const PURE_DELETION: &str = "diff --git a/foo.py b/foo.py\nindex 1111111..2222222 100644\n--- a/foo.py\n+++ b/foo.py\n@@ -1,3 +1,2 @@\n a = 1\n-b = 2\n c = 3\n";

    #[test]
    fn pure_deletion_has_zero_new_range() {
        let hunks = analyze_diff(PURE_DELETION);
        assert_eq!(hunks.len(), 1);
        let h = &hunks[0];
        assert_eq!((h.new_start, h.new_end), (0, 0));
        assert!(h.new_lines.is_empty());
        assert_eq!(h.old_lines, vec!["b = 2".to_string()]);
        assert_eq!((h.old_start, h.old_end), (2, 2));
    }

    const MULTI_RUN: &str = "diff --git a/foo.py b/foo.py\nindex 1111111..2222222 100644\n--- a/foo.py\n+++ b/foo.py\n@@ -1,6 +1,6 @@\n a = 1\n-b = 2\n+b = 20\n c = 3\n-d = 4\n+d = 40\n e = 5\n";

    #[test]
    fn multiple_runs_in_one_hunk_become_separate_hunks() {
        let hunks = analyze_diff(MULTI_RUN);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].old_lines, vec!["b = 2".to_string()]);
        assert_eq!(hunks[0].new_lines, vec!["b = 20".to_string()]);
        assert_eq!((hunks[0].old_start, hunks[0].old_end), (2, 2));
        assert_eq!((hunks[0].new_start, hunks[0].new_end), (2, 2));
        assert_eq!(hunks[1].old_lines, vec!["d = 4".to_string()]);
        assert_eq!(hunks[1].new_lines, vec!["d = 40".to_string()]);
        assert_eq!((hunks[1].old_start, hunks[1].old_end), (4, 4));
        assert_eq!((hunks[1].new_start, hunks[1].new_end), (4, 4));
        // distinct runs must hash differently
        assert_ne!(hunks[0].hunk_hash, hunks[1].hunk_hash);
    }

    const CLASS_CONTEXT: &str = "diff --git a/stock.py b/stock.py\nindex 1111111..2222222 100644\n--- a/stock.py\n+++ b/stock.py\n@@ -1,4 +1,4 @@\n class Stock:\n     def describe(self):\n-        return 1\n+        return 2\n";

    #[test]
    fn symbol_detected_from_context_lines() {
        let hunks = analyze_diff(CLASS_CONTEXT);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].symbol, "describe");
    }

    const HEADER_HINT_ONLY: &str = "diff --git a/payments.py b/payments.py\nindex 1111111..2222222 100644\n--- a/payments.py\n+++ b/payments.py\n@@ -10,3 +10,3 @@ def charge(self):\n    x = 1\n-    y = 2\n+    y = 3\n";

    #[test]
    fn symbol_falls_back_to_header_hint_when_no_context_match() {
        // No in-hunk context line matches the symbol regex, so the header's
        // own trailing hint ("def charge(self):") must be used.
        let hunks = analyze_diff(HEADER_HINT_ONLY);
        assert_eq!(hunks[0].symbol, "charge");
    }

    #[test]
    fn multi_file_diff_assigns_hunks_to_correct_file() {
        let combined = format!("{}{}", PURE_ADDITION, PURE_DELETION.replacen("foo.py", "bar.py", 10));
        let hunks = analyze_diff(&combined);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].file, "foo.py");
        assert_eq!(hunks[1].file, "bar.py");
    }
}
