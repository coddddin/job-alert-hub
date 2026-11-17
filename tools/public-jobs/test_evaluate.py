import unittest
from evaluate import evaluate


class EvaluationTests(unittest.TestCase):
    def test_coverage_is_not_accuracy_and_unreviewed_is_not_missing(self):
        cases = [
            {'expected': {'title': 'correct'}, 'observation': {'fields': {'title': {'value': 'wrong'}}}},
            {'expected': {'title': 'correct'}, 'observation': {'fields': {'title': {'value': None}}}},
            {'expected': {'title': None}, 'observation': {'fields': {'title': {'value': 'invented'}}}},
            {'expected': {}, 'observation': {'fields': {}}},
        ]
        result = evaluate(cases)['fields']
        self.assertEqual(result['title']['coverage'], 0.5)
        self.assertEqual(result['title']['accuracy'], 0)
        self.assertEqual(result['title']['falsePositives'], 1)
        self.assertEqual(result['title']['reviewed'], 3)
        self.assertIsNone(result['company']['accuracy'])

    def test_whitespace_only_normalization(self):
        case = {'expected': {'title': 'a b'}, 'observation': {'fields': {'title': {'value': ' a\n b '}}}}
        self.assertEqual(evaluate([case])['fields']['title']['accuracy'], 1)

    def test_invalid_gold_label_rejected(self):
        with self.assertRaises(ValueError):
            evaluate([{'expected': {'title': []}, 'observation': {}}])
