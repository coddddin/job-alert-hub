"""Compare independently labelled fields with observations; never infer gold labels.

Input: [{"expected": {field: string|null}, "observation": {...}}].
Omitted labels are unreviewed. Explicit null labels mean verified absent.
"""
import argparse
import json
from pathlib import Path
from extract import FIELDS, clean


def evaluate(cases):
    result = {}
    for field in FIELDS:
        reviewed = present = extracted = correct = absent = false_positive = 0
        for case in cases:
            expected = case['expected']
            if field not in expected:
                continue
            truth = expected[field]
            if truth is not None and (not isinstance(truth, str) or not clean(truth)):
                raise ValueError('Gold labels must be nonempty strings or null')
            actual = case['observation']['fields'][field]['value']
            reviewed += 1
            if truth is None:
                absent += 1
                false_positive += actual is not None
            else:
                present += 1
                extracted += actual is not None
                correct += isinstance(actual, str) and clean(actual) == clean(truth)
        result[field] = {
            'reviewed': reviewed, 'present': present, 'extracted': extracted, 'exactMatches': correct,
            'verifiedAbsent': absent, 'falsePositives': false_positive,
            'coverage': extracted / present if present else None,
            'accuracy': correct / present if present else None,
        }
    return {'cases': len(cases), 'comparison': 'whitespace-normalized exact text', 'fields': result}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('labels', type=Path)
    args = parser.parse_args()
    print(json.dumps(evaluate(json.loads(args.labels.read_text(encoding='utf-8'))), indent=2))
