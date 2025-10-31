#!/usr/bin/env python

from transformers import AutoTokenizer, AutoModelForCausalLM
import torch
import sys
import re
import json

def parse_relationships(text: str):
    rels = []
    for part in re.split(r"[,\n;]+", text):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"(.+?)->\s*([+-])\s*(.+)", part)
        if not m:
            continue
        frm, pol, to = m.group(1).strip(), m.group(2), m.group(3).strip()
        rels.append({"from": frm, "to": to, "polarity": pol})
    return rels

if __name__=="__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No prompt given"}))
        
    else:
        MODEL = "dorito96/qwen2.5-1.5b_causal"

        tok = AutoTokenizer.from_pretrained(MODEL, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            MODEL,
            dtype=(torch.bfloat16 if torch.cuda.is_available() and torch.cuda.is_bf16_supported()
                        else (torch.float16 if torch.cuda.is_available() else torch.float32)),
            device_map=("auto" if torch.cuda.is_available() else "cpu"),
            trust_remote_code=True,
        )
        model.eval()

        PROMPT_PREFIX = "### Paragraph:\n"
        TARGET_PREFIX = "\n\n### Targets:\n"

        paragraph = sys.argv[1]
        prompt = f"{PROMPT_PREFIX}{paragraph}{TARGET_PREFIX}"

        inputs = tok(prompt, return_tensors="pt").to(next(model.parameters()).device)
        gen = model.generate(
            **inputs,
            max_new_tokens=512,
            num_beams=4,
            do_sample=False,
            eos_token_id=tok.eos_token_id,
            pad_token_id=tok.pad_token_id,
            no_repeat_ngram_size=3,
        )
        text = tok.decode(gen[0, inputs['input_ids'].shape[1]:], skip_special_tokens=True).strip()
        relationships = parse_relationships(text)

        out = {"success": True, "model": {"relationships": relationships}}
        sys.stdout.write(json.dumps(out))
