const normalizeCourseKey = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[º°]/g, '')
  .replace(/\b(basico|básico)\b/g, 'basico')
  .replace(/\b(medio|media)\b/g, 'medio')
  .replace(/[^a-z0-9]/g, '');

const levenshteinDistance = (left, right) => {
  const a = String(left || '');
  const b = String(right || '');
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const upper = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = upper;
    }
  }
  return previous[b.length];
};

const similarity = (left, right) => {
  const a = normalizeCourseKey(left);
  const b = normalizeCourseKey(right);
  const maxLength = Math.max(a.length, b.length);
  if (!maxLength) return 1;
  return 1 - (levenshteinDistance(a, b) / maxLength);
};

const findCourseMatch = (value, courses) => {
  const key = normalizeCourseKey(value);
  if (!key) return { kind: 'missing', course: null, score: 0 };

  const exact = courses.find((course) => normalizeCourseKey(course.nombre_curso) === key);
  if (exact) return { kind: 'exact', course: exact, score: 1 };

  const ranked = courses
    .map((course) => ({ course, score: similarity(value, course.nombre_curso) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0] || null;
  if (best && best.score >= 0.72) return { kind: 'suggested', ...best };
  return { kind: 'unknown', course: null, score: best?.score || 0 };
};

module.exports = {
  findCourseMatch,
  levenshteinDistance,
  normalizeCourseKey,
  similarity
};
