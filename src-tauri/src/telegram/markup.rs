use serde_json::Value;

/// Converts TipTap JSON document to Telegram HTML string.
pub fn tiptap_to_telegram_html(json: &str) -> Result<String, String> {
    let doc: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let content = doc.get("content").and_then(|v| v.as_array());

    let mut output = String::new();
    if let Some(nodes) = content {
        for node in nodes {
            render_node(node, &mut output);
        }
    }

    Ok(output.trim_end().to_string())
}

fn render_node(node: &Value, out: &mut String) {
    let node_type = node.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match node_type {
        "paragraph" => {
            render_content(node, out);
            out.push_str("\n\n");
        }
        "blockquote" => {
            let mut inner = String::new();
            render_content(node, &mut inner);
            out.push_str(&format!("<blockquote>{}</blockquote>\n", inner.trim()));
        }
        "bulletList" | "orderedList" => {
            if let Some(items) = node.get("content").and_then(|v| v.as_array()) {
                for (i, item) in items.iter().enumerate() {
                    let prefix = if node_type == "orderedList" {
                        format!("{}. ", i + 1)
                    } else {
                        "• ".to_string()
                    };
                    out.push_str(&prefix);
                    render_content(item, out);
                    out.push('\n');
                }
            }
            out.push('\n');
        }
        "codeBlock" => {
            let mut inner = String::new();
            render_content(node, &mut inner);
            out.push_str(&format!("<pre>{}</pre>\n", inner));
        }
        "hardBreak" => out.push('\n'),
        _ => render_content(node, out),
    }
}

fn render_content(node: &Value, out: &mut String) {
    if let Some(children) = node.get("content").and_then(|v| v.as_array()) {
        for child in children {
            render_node(child, out);
        }
    } else if let Some(text) = node.get("text").and_then(|v| v.as_str()) {
        let marked = apply_marks(text, node.get("marks").and_then(|v| v.as_array()));
        out.push_str(&marked);
    }
}

fn apply_marks(text: &str, marks: Option<&Vec<Value>>) -> String {
    let Some(marks) = marks else {
        return html_escape(text).to_string();
    };

    let mut result = html_escape(text).to_string();
    for mark in marks.iter().rev() {
        let mark_type = mark.get("type").and_then(|v| v.as_str()).unwrap_or("");
        result = match mark_type {
            "bold" => format!("<b>{}</b>", result),
            "italic" => format!("<i>{}</i>", result),
            "underline" => format!("<u>{}</u>", result),
            "strike" => format!("<s>{}</s>", result),
            "code" => format!("<code>{}</code>", result),
            "spoiler" => format!("<tg-spoiler>{}</tg-spoiler>", result),
            "link" => {
                let href = mark
                    .get("attrs")
                    .and_then(|a| a.get("href"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("#");
                format!("<a href=\"{}\">{}</a>", href, result)
            }
            _ => result,
        };
    }
    result
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
