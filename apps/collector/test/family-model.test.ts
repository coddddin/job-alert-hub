import { describe, expect, it } from 'vitest';
import { charWbNgrams, estimateFamilies, FAMILY_MODEL_VERSION, type FamilyModel } from '../src/classify/model.js';

describe('family model', () => {
  it('builds the same char_wb n-grams as scikit-learn', () => {
    // TfidfVectorizer(analyzer='char_wb', ngram_range=(2, 4)).build_analyzer()('AI  엔지니어 | C')
    expect(charWbNgrams('AI  엔지니어 | C', [2, 4])).toEqual([' a', 'ai', 'i ', ' ai', 'ai ', ' ai ', ' 엔', '엔지', '지니', '니어', '어 ', ' 엔지', '엔지니', '지니어', '니어 ', ' 엔지니', '엔지니어', '지니어 ', ' |', '| ', ' | ', ' c', 'c ', ' c ']);
  });

  const tiny: FamilyModel = {
    version: 'test/1', ngram: [2, 2], classes: ['office', 'it', 'nope'], intercepts: [-1, -1, 5],
    features: [['회계', 1, { 0: 6 }], ['개발', 1, { 1: 3, 0: 2.5 }], ['세무', 1, { 0: 1 }]],
  };
  it('ranks families, keeps close ones, ignores unknown classes and explains with words', () => {
    expect(estimateFamilies('재무회계 담당', ['세무', '개발'], tiny)).toEqual({ families: ['office', 'it'], confidence: 0.99, evidence: ['재무회계', '개발', '세무'] });
    expect(estimateFamilies('회계', [], tiny)?.families).toEqual(['office']);
  });
  it('returns null without known features or below the floor', () => {
    expect(estimateFamilies('전혀 다른 글', [], tiny)).toBeNull();
    expect(estimateFamilies('회계', [], { ...tiny, intercepts: [-9, -9, 0] })).toBeNull();
  });
  it('ships trained weights for the 16 families', () => {
    expect(FAMILY_MODEL_VERSION).toBe('family-model/1');
    expect(estimateFamilies('간호사 모집', ['간호사'])?.families[0]).toBe('medical');
    expect(estimateFamilies('백엔드 개발자', ['Java', 'Spring'])?.families[0]).toBe('it');
  });
});
