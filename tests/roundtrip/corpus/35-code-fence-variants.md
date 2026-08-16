A fence with no language:

```
plain text, no highlighting
```

A fence whose content holds a shorter fence:

````
```
nested, and the outer fence has to grow
```
````

A fence holding Markdown of its own:

```markdown
# A heading inside a fence

- A list that must not be parsed
```

A fence holding a blank line:

```js
const a = 1;

const b = 2;
```
