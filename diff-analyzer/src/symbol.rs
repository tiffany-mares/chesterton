//! Best-effort "nearest enclosing function/class" detection.
//!
//! Strategy (per the task brief): scan the diff's own context lines first
//! (closest-preceding-line wins); if none match, fall back to a regex
//! heuristic over ALL preceding lines in the hunk (any kind); if still
//! nothing, try the hunk header's own trailing hint (git's `@@ ... @@ <hint>`
//! text). Otherwise `""`.

use crate::parser::{DiffLine, LineKind};
use regex::Regex;
use std::sync::OnceLock;

fn symbol_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^\s*(def |class |fn |func |function |public .*\()").expect("valid regex")
    })
}

pub fn find_symbol(preceding: &[DiffLine], header_hint: &str) -> String {
    // Phase 1: nearest-preceding context ("unchanged code") line that matches.
    for line in preceding.iter().rev() {
        if line.kind == LineKind::Context
            && let Some(name) = extract_if_match(&line.content) {
                return name;
            }
    }
    // Phase 2: context was insufficient; fall back to any preceding line
    // (added/removed code counts too) in the same hunk.
    for line in preceding.iter().rev() {
        if let Some(name) = extract_if_match(&line.content) {
            return name;
        }
    }
    // Phase 3: git's own best-effort hint on the `@@ ... @@` header line.
    if let Some(name) = extract_if_match(header_hint) {
        return name;
    }
    String::new()
}

fn extract_if_match(line: &str) -> Option<String> {
    if !symbol_regex().is_match(line) {
        return None;
    }
    let name = extract_name(line);
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn extract_name(line: &str) -> String {
    let trimmed = line.trim_start();
    for kw in ["def ", "class ", "fn ", "func ", "function "] {
        if let Some(rest) = trimmed.strip_prefix(kw) {
            return take_identifier(rest);
        }
    }
    if trimmed.starts_with("public ")
        && let Some(paren_idx) = trimmed.find('(') {
            let before = &trimmed[..paren_idx];
            if let Some(name) = before.split_whitespace().last() {
                return name.trim_start_matches('*').to_string();
            }
        }
    String::new()
}

fn take_identifier(s: &str) -> String {
    s.chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(content: &str) -> DiffLine {
        DiffLine {
            kind: LineKind::Context,
            content: content.to_string(),
            old_line_no: Some(1),
            new_line_no: Some(1),
        }
    }

    fn removed(content: &str) -> DiffLine {
        DiffLine {
            kind: LineKind::Remove,
            content: content.to_string(),
            old_line_no: Some(1),
            new_line_no: None,
        }
    }

    #[test]
    fn finds_python_def_in_context() {
        let lines = vec![ctx("class Stock:"), ctx("    def describe(self):")];
        assert_eq!(find_symbol(&lines, ""), "describe");
    }

    #[test]
    fn finds_class_when_no_def_present() {
        let lines = vec![ctx("class Stock:")];
        assert_eq!(find_symbol(&lines, ""), "Stock");
    }

    #[test]
    fn finds_rust_fn() {
        let lines = vec![ctx("fn charge(amount: u64) {")];
        assert_eq!(find_symbol(&lines, ""), "charge");
    }

    #[test]
    fn finds_go_func() {
        let lines = vec![ctx("func Charge(amount int) error {")];
        assert_eq!(find_symbol(&lines, ""), "Charge");
    }

    #[test]
    fn finds_js_function() {
        let lines = vec![ctx("function charge(amount) {")];
        assert_eq!(find_symbol(&lines, ""), "charge");
    }

    #[test]
    fn finds_java_public_method() {
        let lines = vec![ctx("public void charge(int amount) {")];
        assert_eq!(find_symbol(&lines, ""), "charge");
    }

    #[test]
    fn nearest_match_wins_over_farther_one() {
        let lines = vec![ctx("class Outer:"), ctx("    def inner(self):")];
        assert_eq!(find_symbol(&lines, ""), "inner");
    }

    #[test]
    fn falls_back_to_non_context_lines_when_no_context_matches() {
        let lines = vec![removed("def helper():")];
        assert_eq!(find_symbol(&lines, ""), "helper");
    }

    #[test]
    fn falls_back_to_header_hint_when_nothing_in_hunk_matches() {
        let lines = vec![ctx("    x = 1")];
        assert_eq!(find_symbol(&lines, "def charge(self):"), "charge");
    }

    #[test]
    fn empty_when_nothing_matches_anywhere() {
        let lines = vec![ctx("x = 1"), ctx("y = 2")];
        assert_eq!(find_symbol(&lines, ""), "");
    }

    #[test]
    fn empty_for_no_preceding_lines_and_no_hint() {
        assert_eq!(find_symbol(&[], ""), "");
    }
}
