//! `hunk_hash` per docs/contracts.md:
//! first 16 hex chars of sha256(file + "\n" + old_lines.join("\n") + "\n=>\n" + new_lines.join("\n"))

use sha2::{Digest, Sha256};

pub fn hunk_hash(file: &str, old_lines: &[String], new_lines: &[String]) -> String {
    let input = format!(
        "{}\n{}\n=>\n{}",
        file,
        old_lines.join("\n"),
        new_lines.join("\n")
    );
    let digest = Sha256::digest(input.as_bytes());
    let hex = hex_encode(&digest);
    hex[..16].to_string()
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vector_matches_formula() {
        // Computed independently via `printf '...' | sha256sum` over the exact
        // formula string, so this assertion is not circular with the implementation.
        let file = "services/payments/client.py".to_string();
        let old_lines = vec!["MAX_RETRIES = 3".to_string()];
        let new_lines = vec!["MAX_RETRIES = 50".to_string()];
        let hash = hunk_hash(&file, &old_lines, &new_lines);
        assert_eq!(hash, "165b1d6186de254f");
        assert_eq!(hash.len(), 16);
    }

    #[test]
    fn hash_is_deterministic() {
        let a = hunk_hash("f.py", &["x".to_string()], &["y".to_string()]);
        let b = hunk_hash("f.py", &["x".to_string()], &["y".to_string()]);
        assert_eq!(a, b);
    }

    #[test]
    fn hash_differs_for_different_inputs() {
        let a = hunk_hash("f.py", &["x".to_string()], &["y".to_string()]);
        let b = hunk_hash("f.py", &["x".to_string()], &["z".to_string()]);
        assert_ne!(a, b);
    }

    #[test]
    fn pure_addition_hash_handles_empty_old_lines() {
        // old_lines empty -> old_lines.join("\n") == "" per the formula; must not panic.
        let hash = hunk_hash("f.py", &[], &["new".to_string()]);
        assert_eq!(hash.len(), 16);
    }
}
