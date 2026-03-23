# -*- coding: utf-8 -*-
from pathlib import Path
path = Path('C:/Users/murat/Desktop/project/choicrew/src/App.tsx')
data = path.read_text(encoding='utf-8')
marker = '\n    return (\n      <div className={`min-h-screen bg-[#F8FAFC] ${isLoggedIn ? "lg:pl-72" : ""}`'
first = data.index(marker)
second = data.index(marker, first + len(marker))
path.write_text(data[:first] + data[second:], encoding='utf-8')
print(first, second)
