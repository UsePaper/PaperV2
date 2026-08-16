> The reader is wrong here:
>
> ```python
> for line in handle:
>     rows.append(line)
> ```
>
> It should check for the trailing newline first.
