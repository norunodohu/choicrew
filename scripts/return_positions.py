# -*- coding: utf-8 -*-
from pathlib import Path
path = Path('C:/Users/murat/Desktop/project/choicrew/src/App.tsx')
data = path.read_text(encoding='utf-8')
start = data.index('\n  if (isPublicView && publicUser) {')
end = data.index('\n  return (\n    <div className="min-h-screen bg-[#F8FAFC] text-gray-900 font-sans"')
segment = data[start:end]
marker = 'return ('
pos = []
idx = segment.find(marker)
while idx != -1:
    pos.append(idx)
    idx = segment.find(marker, idx + 1)
print(pos)
print('snippet around second:', segment[pos[1]:pos[1]+200])
print('snippet around third:', segment[pos[2]:pos[2]+200])
