import { nameForms, namesEqual, nameContains, namesMatch } from '../../evals/utilities/nameMatching.js';

describe('nameMatching', () => {
  describe('nameForms', () => {
    it('should hold both numbers of a regular noun', () => {
      expect(nameForms('frimbulators')).toContain('frimbulator');
      expect(nameForms('frimbulator')).toContain('frimbulators');
    });

    it('should hold both numbers of an irregular noun pluralize cannot round trip', () => {
      expect(nameForms('priaries')).toContain('priary');
      expect(nameForms('priary')).toContain('priaries');
    });

    it('should expand every word of a module qualified name', () => {
      const forms = nameForms('priaries.frimbulators count');
      expect(forms).toContain('priary.frimbulatorcount');
      expect(forms).toContain('priaries.frimbulatorscount');
    });

    it('should strip whitespace and underscores', () => {
      expect(nameForms('existing_stock_a')).toContain('existingstocka');
      expect(nameForms('existing stock a')).toContain('existingstocka');
    });
  });

  describe('namesEqual', () => {
    //the four gibberish nouns whose plural does not contain their singular
    it.each([
      ['priary', 'priaries'],
      ['reveforly', 'reveforlies'],
      ['pershipfulty', 'pershipfulties'],
      ['relity', 'relities']
    ])('should match %s against its irregular plural %s in both directions', (singular, plural) => {
      expect(namesEqual(plural, singular)).toBe(true);
      expect(namesEqual(singular, plural)).toBe(true);
    });

    it('should match a regularized plural against the irregular one the prose used', () => {
      expect(namesEqual('priarys', 'priaries')).toBe(true);
    });

    it('should match a noun which already looks plural against its singularization', () => {
      //pluralize() leaves "phildiscals" alone, so the prose says "phildiscals" either way
      expect(namesEqual('phildiscal', 'phildiscals')).toBe(true);
    });

    it('should match a noun pluralize leaves alone against a regularized plural', () => {
      //pluralize() reads "loopnova" as an already plural latin noun and leaves it alone
      expect(namesEqual('loopnovas', 'loopnova')).toBe(true);
    });

    it('should match a noun whose plural pluralize cannot pluralize again', () => {
      //pluralize("ku") is "kus", and pluralize("kus") is "kuses"
      expect(namesEqual('kus', 'ku')).toBe(true);
      expect(namesEqual('ku', 'kus')).toBe(true);
    });

    it('should match an -es plural', () => {
      expect(namesEqual('dickstonyxes', 'dickstonyx')).toBe(true);
    });

    it('should not match two different nouns', () => {
      expect(namesEqual('frimbulators', 'whatajigs')).toBe(false);
      expect(namesEqual('priaries', 'younjurings')).toBe(false);
      expect(namesEqual('oc', 'oclate')).toBe(false);
    });

    it('should not match a name which merely contains the other', () => {
      expect(namesEqual('frimbulators.count', 'frimbulators')).toBe(false);
    });
  });

  describe('nameContains', () => {
    it('should see past pluralization inside a module qualified name', () => {
      expect(nameContains('frimbulator.count', 'frimbulators.count')).toBe(true);
      expect(nameContains('frimbulators.count', 'frimbulator.count')).toBe(true);
      expect(nameContains('priarys.count', 'priaries.count')).toBe(true);
      expect(nameContains('ku.count', 'kus.count')).toBe(true);
      expect(nameContains('loopnovas.count', 'loopnova.count')).toBe(true);
    });

    it('should allow the generated name to be the longer of the two', () => {
      expect(nameContains('number of priarys', 'priary')).toBe(true);
    });

    it('should not allow the ground truth name to be the longer of the two', () => {
      expect(nameContains('priary', 'number of priaries')).toBe(false);
    });

    it('should not match a different noun', () => {
      expect(nameContains('younjurings.count', 'priaries.count')).toBe(false);
    });
  });

  describe('namesMatch', () => {
    it('should match whichever name is the longer of the two', () => {
      expect(namesMatch('priary', 'priaries stock')).toBe(true);
      expect(namesMatch('priaries stock', 'priary')).toBe(true);
    });

    it('should match a time unit given in either number', () => {
      expect(namesMatch('days', 'day')).toBe(true);
      expect(namesMatch('day', 'days')).toBe(true);
    });

    it('should not match different time units', () => {
      expect(namesMatch('weeks', 'day')).toBe(false);
    });
  });
});
