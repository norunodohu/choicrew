# -*- coding: utf-8 -*-
from pathlib import Path
path = Path('C:/Users/murat/Desktop/project/choicrew/src/App.tsx')
data = path.read_text(encoding='utf-8')
start = data.index('\n  if (isPublicView && publicUser) {')
end = data.index('\n  return (\n    <div className="min-h-screen bg-[#F8FAFC] text-gray-900 font-sans"')
segment = data[start:end]
for i, pos in enumerate([segment.find('return (') for _ in range(1)]):
    pass
print('segment start', start, 'end', end)
print(segment.count('return ('))
print('first 200:', segment[:200])
