//! `POST /remap` logic: map old-file anchor line ranges to new-file positions
//! using the same diff, per docs/contracts.md.
//!
//! An anchor is `alive:false` if any of its lines fall inside a *pure
//! deletion* run (removed lines with no replacement added lines in the same
//! minimal change run). Lines inside a modification run (removed lines with
//! a corresponding added run) are not considered deleted-without-replacement
//! and keep the anchor alive, remapped into the new run's range.

use crate::parser::{parse_file_diffs, FileDiff, LineKind, RawHunk};
use crate::types::{AnchorRequest, AnchorResponse};

pub fn remap_anchors(diff_text: &str, anchors: &[AnchorRequest]) -> Vec<AnchorResponse> {
    let file_diffs = parse_file_diffs(diff_text);
    anchors
        .iter()
        .map(|a| remap_one(&file_diffs, a))
        .collect()
}

fn remap_one(file_diffs: &[FileDiff], anchor: &AnchorRequest) -> AnchorResponse {
    let Some(fd) = file_diffs.iter().find(|f| f.file == anchor.file) else {
        return AnchorResponse {
            file: anchor.file.clone(),
            line_start: anchor.line_start,
            line_end: anchor.line_end,
            alive: true,
        };
    };

    let alive = !fd
        .hunks
        .iter()
        .any(|hunk| overlaps_pure_deletion(hunk, anchor.line_start, anchor.line_end));

    let new_start = map_old_line(fd, anchor.line_start);
    let new_end = map_old_line(fd, anchor.line_end);

    AnchorResponse {
        file: anchor.file.clone(),
        line_start: new_start,
        line_end: new_end,
        alive,
    }
}

/// True if any old line in `[a_start, a_end]` belongs to a minimal change run
/// in `hunk` that removed lines without adding any replacement lines.
fn overlaps_pure_deletion(hunk: &RawHunk, a_start: usize, a_end: usize) -> bool {
    for_each_run(hunk, |run| {
        let has_add = run.iter().any(|l| l.kind == LineKind::Add);
        if has_add {
            return false;
        }
        run.iter().any(|l| match l.old_line_no {
            Some(n) => n >= a_start && n <= a_end,
            None => false,
        })
    })
}

/// Runs `f` over each maximal run of consecutive non-context lines in
/// `hunk`, short-circuiting (returning `true`) as soon as `f` does.
fn for_each_run(hunk: &RawHunk, mut f: impl FnMut(&[crate::parser::DiffLine]) -> bool) -> bool {
    let lines = &hunk.lines;
    let mut idx = 0usize;
    while idx < lines.len() {
        if lines[idx].kind == LineKind::Context {
            idx += 1;
            continue;
        }
        let start = idx;
        while idx < lines.len() && lines[idx].kind != LineKind::Context {
            idx += 1;
        }
        if f(&lines[start..idx]) {
            return true;
        }
    }
    false
}

/// Maps a single old-file line number to its new-file position.
fn map_old_line(fd: &FileDiff, old_line: usize) -> usize {
    let mut cumulative_offset: i64 = 0;

    for hunk in &fd.hunks {
        if hunk.old_count == 0 {
            // Pure-insertion hunk: no old lines consumed. old_start marks the
            // old-file line after which the insertion happens.
            if old_line <= hunk.old_start {
                return (old_line as i64 + cumulative_offset) as usize;
            }
            cumulative_offset += hunk.new_count as i64 - hunk.old_count as i64;
            continue;
        }

        let old_hunk_end = hunk.old_start + hunk.old_count - 1;
        if old_line < hunk.old_start {
            return (old_line as i64 + cumulative_offset) as usize;
        }
        if old_line <= old_hunk_end {
            return map_within_hunk(hunk, old_line);
        }
        cumulative_offset += hunk.new_count as i64 - hunk.old_count as i64;
    }

    (old_line as i64 + cumulative_offset) as usize
}

fn map_within_hunk(hunk: &RawHunk, old_line: usize) -> usize {
    let Some(dl) = hunk
        .lines
        .iter()
        .find(|l| l.kind != LineKind::Add && l.old_line_no == Some(old_line))
    else {
        return old_line;
    };

    if let Some(n) = dl.new_line_no {
        // Context line: exact mapping.
        return n;
    }

    // Removed line with no direct new_line_no: find its run.
    map_removed_line(hunk, old_line)
}

fn map_removed_line(hunk: &RawHunk, old_line: usize) -> usize {
    let lines = &hunk.lines;
    let mut idx = 0usize;
    while idx < lines.len() {
        if lines[idx].kind == LineKind::Context {
            idx += 1;
            continue;
        }
        let start = idx;
        while idx < lines.len() && lines[idx].kind != LineKind::Context {
            idx += 1;
        }
        let run = &lines[start..idx];
        if !run.iter().any(|l| l.old_line_no == Some(old_line)) {
            continue;
        }

        let add_nums: Vec<usize> = run
            .iter()
            .filter(|l| l.kind == LineKind::Add)
            .filter_map(|l| l.new_line_no)
            .collect();

        if !add_nums.is_empty() {
            // Modification run: map proportionally into the replacement range.
            let remove_positions: Vec<usize> = run
                .iter()
                .filter(|l| l.kind == LineKind::Remove)
                .filter_map(|l| l.old_line_no)
                .collect();
            let pos = remove_positions
                .iter()
                .position(|&n| n == old_line)
                .unwrap_or(0);
            let clamped = pos.min(add_nums.len() - 1);
            return add_nums[clamped];
        }

        // Pure deletion: best-effort "collapse point" - the nearest
        // preceding context line's new position, else this hunk's new_start.
        for l in lines[..start].iter().rev() {
            if l.kind == LineKind::Context
                && let Some(n) = l.new_line_no {
                    return n;
                }
        }
        return hunk.new_start;
    }

    old_line
}

#[cfg(test)]
mod tests {
    use super::*;

    // Old file:            New file:
    // 1: a = 1              1: a = 1
    // 2: b = 2               2: x = 0
    // 3: c = 3               3: y = 0
    //                        4: b = 2
    //                        5: c = 3
    const SHIFT_DIFF: &str = "diff --git a/foo.py b/foo.py\nindex 1111111..2222222 100644\n--- a/foo.py\n+++ b/foo.py\n@@ -1,3 +1,5 @@\n a = 1\n+x = 0\n+y = 0\n b = 2\n c = 3\n";

    #[test]
    fn anchor_after_pure_addition_shifts_forward() {
        let anchors = vec![AnchorRequest {
            file: "foo.py".to_string(),
            line_start: 3,
            line_end: 3,
        }];
        let result = remap_anchors(SHIFT_DIFF, &anchors);
        assert_eq!(result.len(), 1);
        assert!(result[0].alive);
        assert_eq!(result[0].line_start, 5);
        assert_eq!(result[0].line_end, 5);
    }

    #[test]
    fn anchor_before_any_hunk_is_unaffected() {
        // line_start/line_end both before the hunk's old range -> identity.
        let diff = "diff --git a/foo.py b/foo.py\nindex 1111111..2222222 100644\n--- a/foo.py\n+++ b/foo.py\n@@ -10,2 +10,4 @@\n z = 1\n+w = 1\n+v = 1\n y = 2\n";
        let anchors = vec![AnchorRequest {
            file: "foo.py".to_string(),
            line_start: 1,
            line_end: 2,
        }];
        let result = remap_anchors(diff, &anchors);
        assert!(result[0].alive);
        assert_eq!(result[0].line_start, 1);
        assert_eq!(result[0].line_end, 2);
    }

    // Old file:            New file:
    // 1: a = 1              1: a = 1
    // 2: b = 2               2: c = 3
    // 3: c = 3
    const KILL_DIFF: &str = "diff --git a/foo.py b/foo.py\nindex 1111111..2222222 100644\n--- a/foo.py\n+++ b/foo.py\n@@ -1,3 +1,2 @@\n a = 1\n-b = 2\n c = 3\n";

    #[test]
    fn anchor_on_pure_deletion_becomes_dead() {
        let anchors = vec![AnchorRequest {
            file: "foo.py".to_string(),
            line_start: 2,
            line_end: 2,
        }];
        let result = remap_anchors(KILL_DIFF, &anchors);
        assert_eq!(result.len(), 1);
        assert!(!result[0].alive);
    }

    #[test]
    fn anchor_spanning_deleted_and_surviving_lines_is_dead() {
        let anchors = vec![AnchorRequest {
            file: "foo.py".to_string(),
            line_start: 1,
            line_end: 3,
        }];
        let result = remap_anchors(KILL_DIFF, &anchors);
        assert!(!result[0].alive);
    }

    #[test]
    fn anchor_in_untouched_file_stays_alive_same_lines() {
        let anchors = vec![AnchorRequest {
            file: "bar.py".to_string(),
            line_start: 10,
            line_end: 12,
        }];
        let result = remap_anchors(KILL_DIFF, &anchors);
        assert!(result[0].alive);
        assert_eq!(result[0].line_start, 10);
        assert_eq!(result[0].line_end, 12);
    }

    // The canonical "modification, not deletion" case from the demo: a single
    // line's content changes but the slot is not removed-without-replacement.
    const MODIFICATION_DIFF: &str = "diff --git a/services/payments/client.py b/services/payments/client.py\nindex c1f660d..ccc8363 100644\n--- a/services/payments/client.py\n+++ b/services/payments/client.py\n@@ -2,7 +2,7 @@\n \n import time\n \n-MAX_RETRIES = 3\n+MAX_RETRIES = 50\n BACKOFF_SECONDS = 2\n TIMEOUT_SECONDS = 10\n DEFAULT_CURRENCY = \"USD\"\n";

    #[test]
    fn anchor_on_modification_run_stays_alive_and_remaps() {
        let anchors = vec![AnchorRequest {
            file: "services/payments/client.py".to_string(),
            line_start: 5,
            line_end: 5,
        }];
        let result = remap_anchors(MODIFICATION_DIFF, &anchors);
        assert!(result[0].alive);
        assert_eq!(result[0].line_start, 5);
        assert_eq!(result[0].line_end, 5);
    }
}
